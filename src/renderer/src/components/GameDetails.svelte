<!-- Displays selected-game metadata and delegates detail-page actions to the application. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import '../styles/game-details.css';
  import ScreenshotGallery from './ScreenshotGallery.svelte';
  import type {
    ArtworkPreview,
    CatalogCollection,
    CatalogGame,
    CatalogView,
    MatchCandidate,
    SettingsView,
  } from '../../../shared/api';

  type DetailModal = 'matching' | 'manual' | 'artwork' | null;

  let {
    game,
    collection,
    settings,
    onCatalog,
    onNotice,
    onClose,
    onOpenCollection,
  }: {
    game: CatalogGame;
    collection?: CatalogCollection;
    settings?: SettingsView;
    onCatalog: (catalog: CatalogView) => void;
    onNotice: (notice: string) => void;
    onClose: () => void;
    onOpenCollection: (id: number) => void;
  } = $props();

  let busy = $state(false);
  let modal = $state<DetailModal>(null);
  let menuOpen = $state(false);
  let editMenu = $state<HTMLDivElement>();
  let query = $state('');
  let searchProvider = $state('');
  let candidates = $state<MatchCandidate[]>([]);
  let searched = $state(false);
  let steamGridDbId = $state('');
  let artworkNotice = $state('');
  let artworkPreview = $state<ArtworkPreview | null>(null);
  let screenshotRevision = $state(0);

  const title = $derived(game.metadata.title || game.displayName);
  const isSingleFile = $derived(
    /\.(zip|rar|iso|exe)$/iu.test(game.relativePath)
  );
  const searchableProviders = $derived(
    (settings?.providerOrder ?? []).filter(
      (id) =>
        id !== 'steamgriddb' &&
        settings?.providers[id]?.enabled &&
        settings.providers[id]?.configured
    )
  );

  onMount(() => {
    const closeMenuOnOutsideClick = (event: PointerEvent) => {
      if (menuOpen && editMenu && !editMenu.contains(event.target as Node)) {
        menuOpen = false;
      }
    };

    document.addEventListener('pointerdown', closeMenuOnOutsideClick);

    return () => {
      document.removeEventListener('pointerdown', closeMenuOnOutsideClick);
    };
  });

  function resetSearch() {
    candidates = [];
    searched = false;
  }

  function publish(result: {
    ok: boolean;
    value?: CatalogView;
    message?: string;
  }) {
    if (result.ok && result.value) onCatalog(result.value);
    onNotice(result.message ?? '');
  }

  function openMatching() {
    query = game.metadata.title || game.displayName;
    searchProvider = searchableProviders[0] ?? '';
    resetSearch();
    menuOpen = false;
    modal = 'matching';
  }

  function openArtwork() {
    artworkNotice = '';
    artworkPreview = null;
    menuOpen = false;
    modal = 'artwork';
  }

  async function match(automatic: boolean, candidate?: MatchCandidate) {
    busy = true;
    onNotice(
      automatic
        ? 'Finding a confident match…'
        : 'Retrieving and saving metadata…'
    );
    try {
      const result = automatic
        ? await window.gameShelf.autoMatch(game.id)
        : await window.gameShelf.selectMatch(
            game.id,
            candidate!.providerId,
            candidate!.recordId
          );
      publish(result);
      if (result.ok) {
        resetSearch();
        if (
          result.value.games.find((item) => item.id === game.id)
            ?.matchStatus === 'matched'
        )
          modal = null;
      }
    } catch {
      onNotice('Matching failed. Please retry.');
    } finally {
      busy = false;
    }
  }

  async function searchMatches() {
    busy = true;
    resetSearch();
    onNotice('Searching the selected metadata provider…');
    try {
      const result = await window.gameShelf.searchMatches(
        game.id,
        query,
        searchProvider || undefined
      );
      if (result.ok) {
        candidates = result.value.candidates;
        searched = true;
      }
      onNotice(result.message ?? '');
    } catch {
      onNotice('Search failed. Please retry.');
    } finally {
      busy = false;
    }
  }

  async function fetchScreenshots() {
    menuOpen = false;
    busy = true;
    try {
      const result = await window.gameShelf.fetchScreenshots(game.id);
      publish(result);
      if (result.ok) screenshotRevision++;
    } catch {
      onNotice('Could not fetch screenshots. Please retry.');
    } finally {
      busy = false;
    }
  }

  async function fetchArtwork() {
    busy = true;
    try {
      const result = await window.gameShelf.fetchArtwork(
        game.id,
        steamGridDbId.trim() || undefined
      );
      if (result.ok) artworkPreview = result.value;
      artworkNotice = result.message ?? '';
      onNotice(artworkNotice);
    } catch {
      artworkNotice = 'Could not fetch artwork. Please retry.';
      onNotice(artworkNotice);
    } finally {
      busy = false;
    }
  }

  async function confirmArtwork() {
    busy = true;
    try {
      const result = await window.gameShelf.confirmArtwork(game.id);
      publish(result);
      if (result.ok) artworkPreview = null;
      artworkNotice = result.message ?? '';
    } catch {
      artworkNotice = 'Could not replace artwork. Please retry.';
      onNotice(artworkNotice);
    } finally {
      busy = false;
    }
  }

  async function openLocation(container = false) {
    busy = true;
    try {
      const result = container
        ? await window.gameShelf.openContainerFolder(game.id)
        : await window.gameShelf.openInstallFolder(game.id);
      onNotice(
        result.message ??
          (container ? 'Container folder opened.' : 'Install location opened.')
      );
    } catch {
      onNotice(
        container
          ? 'Unable to open the container folder. Please retry.'
          : 'Unable to open the install location. Please retry.'
      );
    } finally {
      busy = false;
    }
  }

  async function clearMetadata() {
    if (
      !confirm(
        'Clear this game’s provider and manual metadata? It will return to Needs Matching. Custom pasted artwork is kept.'
      )
    )
      return;
    busy = true;
    try {
      const result = await window.gameShelf.clearMetadata(game.id);
      publish(result);
      if (result.ok) {
        resetSearch();
        modal = null;
      }
    } catch {
      onNotice('Could not clear metadata. Please retry.');
    } finally {
      busy = false;
    }
  }

  async function saveManual(form: HTMLFormElement) {
    busy = true;
    try {
      const result = await window.gameShelf.saveOverrides(game.id, {
        title: (form.elements.namedItem('manual-title') as HTMLInputElement)
          .value,
        description: (
          form.elements.namedItem('manual-description') as HTMLTextAreaElement
        ).value,
      });
      publish(result);
    } catch {
      onNotice('Could not save manual metadata. Please retry.');
    } finally {
      busy = false;
    }
  }

  async function pasteArtwork(kind: 'cover' | 'background') {
    busy = true;
    try {
      publish(await window.gameShelf.pasteArtwork(game.id, kind));
    } catch {
      onNotice('Could not paste artwork. Please retry.');
    } finally {
      busy = false;
    }
  }

  async function replaceManualWork() {
    if (
      !confirm(
        'Replace all manual metadata and artwork with the current provider data?'
      )
    )
      return;
    busy = true;
    try {
      publish(await window.gameShelf.replaceAllRescrape(game.id));
    } catch {
      onNotice('Could not replace manual work. Please retry.');
    } finally {
      busy = false;
    }
  }

  const date = (value: string) => new Date(value).toLocaleString();
</script>

<section class="details" aria-label="Game details">
  <div class="detail-controls">
    <div class="edit-menu" bind:this={editMenu}>
      <button
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onclick={() => (menuOpen = !menuOpen)}
        >Edit <span aria-hidden="true">⋮</span></button
      >{#if menuOpen}<div class="edit-menu-items" role="menu">
          <button role="menuitem" onclick={openMatching}
            >{game.matchStatus === 'matched'
              ? 'Change match'
              : 'Find metadata'}</button
          ><button
            role="menuitem"
            onclick={() => {
              menuOpen = false;
              modal = 'manual';
            }}>Edit metadata & artwork</button
          >{#if game.matchStatus === 'matched'}<button
              role="menuitem"
              onclick={openArtwork}>Fetch artwork</button
            >{/if}{#if game.providerId === 'igdb'}<button
              role="menuitem"
              disabled={busy}
              onclick={fetchScreenshots}>Fetch screenshots</button
            >{/if}<button role="menuitem" class="danger" onclick={clearMetadata}
            >Clear all metadata</button
          >
        </div>{/if}
    </div>
    <button
      class="details-close"
      aria-label="Close game details"
      onclick={onClose}>×</button
    >
  </div>
  <div class="detail-hero" class:has-background={Boolean(game.backgroundUrl)}>
    {#if game.backgroundUrl}<img
        class="background"
        src={game.backgroundUrl}
        alt=""
      />{/if}
    <div class="detail-heading"><h2>{title}</h2></div>
  </div>
  <div class="detail-aside">
    {#if game.coverUrl}<img
        class="cover"
        src={game.coverUrl}
        alt={`Cover for ${title}`}
      />{:else}<div
        class="cover placeholder"
        aria-label="No cover artwork available"
      >
        No cover artwork
      </div>{/if}{#if collection}<button
        class="collection-link"
        onclick={() => onOpenCollection(collection!.id)}
        ><small>Found in collection</small><strong
          >{collection.displayName || collection.folderName}</strong
        ></button
      >{/if}{#key `${game.id}:${screenshotRevision}`}<ScreenshotGallery
        urls={(game.screenshotUrls ?? []).map(
          (url) => `${url}?revision=${screenshotRevision}`
        )}
        {title}
      />{/key}
  </div>
  {#if game.metadata.description}<p class="description">
      {game.metadata.description}
    </p>{/if}
  <div class="location-actions">
    <button class="install" disabled={busy} onclick={() => openLocation()}
      ><svg class="action-icon" aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" />
        <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
      </svg>
      Install</button
    >{#if isSingleFile}<button
        disabled={busy}
        onclick={() => openLocation(true)}
        ><svg class="action-icon" aria-hidden="true" viewBox="0 0 24 24">
          <path d="M3 7h7l2 2h9v10H3V7Z" />
        </svg>
        Open Container Folder</button
      >{/if}
  </div>
  <dl>
    <dt>Metadata match</dt>
    <dd>
      {game.matchStatus === 'matched'
        ? `${game.bindingSource} · ${game.providerId} · ${game.providerRecordId}`
        : 'Needs matching'}
    </dd>
    {#if game.metadata.releaseYear}<dt>Release year</dt>
      <dd>{game.metadata.releaseYear}</dd>{/if}
    {#if game.metadata.developers?.length}<dt>Developer</dt>
      <dd>{game.metadata.developers.join(', ')}</dd>{/if}
    {#if game.metadata.publishers?.length}<dt>Publisher</dt>
      <dd>{game.metadata.publishers.join(', ')}</dd>{/if}
    {#if game.metadata.genres?.length}<dt>Genres</dt>
      <dd>{game.metadata.genres.join(', ')}</dd>{/if}
    {#if game.metadata.platforms?.length}<dt>Platforms</dt>
      <dd>{game.metadata.platforms.join(', ')}</dd>{/if}
    {#if game.metadata.rating !== undefined}<dt>Rating</dt>
      <dd>{game.metadata.rating.toFixed(1)} / 100</dd>{/if}
    <dt>Status</dt>
    <dd>{game.missing ? 'Missing at last scan' : 'Present at last scan'}</dd>
    <dt>Folder within library</dt>
    <dd class="path">{game.relativePath}</dd>
    <dt>Collection</dt>
    <dd>
      {collection ? collection.displayName || collection.folderName : 'None'}
    </dd>
    <dt>Added</dt>
    <dd>{date(game.addedAt)}</dd>
    <dt>Last seen</dt>
    <dd>{date(game.lastSeenAt)}</dd>
  </dl>

  {#if modal === 'matching'}<div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      onclick={() => (modal = null)}
      onkeydown={(event) => {
        if (event.key === 'Escape' || event.key === 'Enter') modal = null;
      }}
    >
      <div
        class="modal"
        role="dialog"
        tabindex="-1"
        aria-label="Metadata matching"
        onclick={(event) => event.stopPropagation()}
        onkeydown={(event) => event.stopPropagation()}
      >
        <button class="close" onclick={() => (modal = null)}>×</button>
        <section class="matching" aria-label="Metadata matching">
          <h3>
            {game.matchStatus === 'matched' ? 'Change match' : 'Find metadata'}
          </h3>
          <div class="match-context">
            <strong>{title}</strong><span
              >Catalog folder: {game.relativePath}</span
            >{#if game.matchStatus === 'matched'}<span
                >Current connection: {game.providerId} · record {game.providerRecordId}
                · {game.bindingSource} match</span
              >{:else}<span>No metadata match is saved yet.</span>{/if}
          </div>
          {#if game.matchStatus === 'unmatched'}<button
              disabled={busy}
              onclick={() => match(true)}>Match automatically</button
            >{/if}
          <form
            onsubmit={(event) => {
              event.preventDefault();
              void searchMatches();
            }}
          >
            <label for="match-query">Search title</label><input
              id="match-query"
              bind:value={query}
              maxlength="250"
              disabled={busy}
              required
            /><label for="match-provider">Search provider</label><select
              id="match-provider"
              bind:value={searchProvider}
              disabled={busy || searchableProviders.length === 0}
              >{#each searchableProviders as provider}<option value={provider}
                  >{provider}</option
                >{/each}</select
            ><button disabled={busy || !query.trim()}>Search candidates</button>
          </form>
          {#if searched}{#if candidates.length === 0}<p class="empty">
                No results from {searchProvider || 'the selected provider'}. Try
                another title or provider.
              </p>{:else}<ul aria-label="Match candidates">
                {#each candidates as candidate (`${candidate.providerId}:${candidate.recordId}`)}<li
                    class="candidate"
                  >
                    <div>
                      <strong>{candidate.title}</strong>
                      <dl>
                        <dt>Release year</dt>
                        <dd>{candidate.releaseYear ?? 'Unknown'}</dd>
                        <dt>Provider</dt>
                        <dd>{candidate.providerId}</dd>
                        <dt>Record ID</dt>
                        <dd>{candidate.recordId}</dd>
                        {#if candidate.platforms?.length}<dt>Platforms</dt>
                          <dd>{candidate.platforms.join(', ')}</dd>{/if}
                        <dt>Artwork</dt>
                        <dd>
                          {candidate.hasArtwork
                            ? 'Available'
                            : 'Not reported by this search'}
                        </dd>
                      </dl>
                    </div>
                    <button
                      class="select-match"
                      disabled={busy}
                      onclick={() => match(false, candidate)}>✓ Select</button
                    >
                  </li>{/each}
              </ul>{/if}{/if}
        </section>
      </div>
    </div>{/if}
  {#if modal === 'manual'}<div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      onclick={() => (modal = null)}
      onkeydown={(event) => {
        if (event.key === 'Escape' || event.key === 'Enter') modal = null;
      }}
    >
      <div
        class="modal"
        role="dialog"
        tabindex="-1"
        aria-label="Manual edits"
        onclick={(event) => event.stopPropagation()}
        onkeydown={(event) => event.stopPropagation()}
      >
        <button class="close" onclick={() => (modal = null)}>×</button>
        <section class="matching" aria-label="Manual edits">
          <h3>Manual metadata and artwork</h3>
          <form
            onsubmit={(event) => {
              event.preventDefault();
              void saveManual(event.currentTarget);
            }}
          >
            <label for="manual-title">Title</label><input
              id="manual-title"
              name="manual-title"
              value={game.metadata.title || ''}
              maxlength="10000"
            /><label for="manual-description">Description</label><textarea
              id="manual-description"
              name="manual-description"
              maxlength="10000">{game.metadata.description || ''}</textarea
            ><button disabled={busy}>Save manual metadata</button>
          </form>
          <button disabled={busy} onclick={() => pasteArtwork('cover')}
            >Paste cover from clipboard</button
          ><button disabled={busy} onclick={() => pasteArtwork('background')}
            >Paste background from clipboard</button
          ><button disabled={busy} onclick={replaceManualWork}
            >Replace all manual work</button
          >
        </section>
      </div>
    </div>{/if}
  {#if modal === 'artwork'}<div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      onclick={() => (modal = null)}
      onkeydown={(event) => {
        if (event.key === 'Escape' || event.key === 'Enter') modal = null;
      }}
    >
      <div
        class="modal"
        role="dialog"
        tabindex="-1"
        aria-label="Fetch artwork"
        onclick={(event) => event.stopPropagation()}
        onkeydown={(event) => event.stopPropagation()}
      >
        <button class="close" onclick={() => (modal = null)}>×</button>
        <section class="matching artwork-modal" aria-label="Fetch artwork">
          <h3>Fetch artwork</h3>
          {#if artworkPreview}<p class="muted">
              Confirm to replace the artwork below. “Manual” means an image
              pasted through Edit metadata & artwork.
            </p>
            <div class="artwork-preview">
              {#each artworkPreview.items as item (item.kind)}<section>
                  <h4>{item.kind === 'cover' ? 'Cover' : 'Background'}</h4>
                  <div class="artwork-comparison">
                    <div>
                      <strong
                        >Current{item.currentSource === 'manual'
                          ? ' · manual'
                          : ''}</strong
                      >{#if item.currentUrl}<img
                          src={item.currentUrl}
                          alt={`Current ${item.kind}`}
                        />{:else}<span class="preview-placeholder"
                          >No current artwork</span
                        >{/if}
                    </div>
                    <div>
                      <strong>New</strong><img
                        src={item.proposedUrl}
                        alt={`New ${item.kind}`}
                      />
                    </div>
                  </div>
                </section>{/each}
            </div>
            <button class="primary" disabled={busy} onclick={confirmArtwork}
              >Replace artwork</button
            ><button
              disabled={busy}
              onclick={() => {
                artworkPreview = null;
                artworkNotice = '';
              }}>Cancel</button
            >{:else}<p class="muted">
              Downloads available cover and background art for review. It does
              not replace anything until you confirm.
            </p>
            <label for="steamgrid-id"
              >SteamGridDB game ID <small
                >Optional; title lookup is used when blank.</small
              ></label
            ><input
              id="steamgrid-id"
              bind:value={steamGridDbId}
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength="19"
              placeholder="Optional SteamGridDB ID"
            /><button disabled={busy} onclick={fetchArtwork}
              >▧ Fetch artwork</button
            >{/if}{#if artworkNotice}<p class="artwork-notice" role="status">
              {artworkNotice}
            </p>{/if}
        </section>
      </div>
    </div>{/if}
</section>
