<script lang="ts">
  import ScreenshotGallery from './ScreenshotGallery.svelte';
  import type { ArtworkPreview, CatalogCollection, CatalogGame, CatalogView, MatchCandidate, SettingsView } from '../../../shared/api';

  type DetailModal = 'matching' | 'manual' | 'artwork' | null;

  let {
    game,
    collection,
    settings,
    onCatalog,
    onNotice,
    onClose,
    onOpenCollection
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
  let query = $state('');
  let searchProvider = $state('');
  let candidates = $state<MatchCandidate[]>([]);
  let searched = $state(false);
  let steamGridDbId = $state('');
  let artworkNotice = $state('');
  let artworkPreview = $state<ArtworkPreview | null>(null);
  let screenshotRevision = $state(0);

  const title = $derived(game.metadata.title || game.displayName);
  const isSingleFile = $derived(/\.(zip|rar|iso|exe)$/iu.test(game.relativePath));
  const searchableProviders = $derived((settings?.providerOrder ?? []).filter(id =>
    id !== 'steamgriddb' && settings?.providers[id]?.enabled && settings.providers[id]?.configured
  ));

  function resetSearch() {
    candidates = [];
    searched = false;
  }

  function publish(result: { ok: boolean; value?: CatalogView; message?: string }) {
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
    onNotice(automatic ? 'Finding a confident match…' : 'Retrieving and saving metadata…');
    try {
      const result = automatic
        ? await window.gameShelf.autoMatch(game.id)
        : await window.gameShelf.selectMatch(game.id, candidate!.providerId, candidate!.recordId);
      publish(result);
      if (result.ok) {
        resetSearch();
        if (result.value.games.find(item => item.id === game.id)?.matchStatus === 'matched') modal = null;
      }
    } catch { onNotice('Matching failed. Please retry.'); }
    finally { busy = false; }
  }

  async function searchMatches() {
    busy = true;
    resetSearch();
    onNotice('Searching the selected metadata provider…');
    try {
      const result = await window.gameShelf.searchMatches(game.id, query, searchProvider || undefined);
      if (result.ok) { candidates = result.value.candidates; searched = true; }
      onNotice(result.message ?? '');
    } catch { onNotice('Search failed. Please retry.'); }
    finally { busy = false; }
  }

  async function fetchScreenshots() {
    menuOpen = false;
    busy = true;
    try {
      const result = await window.gameShelf.fetchScreenshots(game.id);
      publish(result);
      if (result.ok) screenshotRevision++;
    } catch { onNotice('Could not fetch screenshots. Please retry.'); }
    finally { busy = false; }
  }

  async function fetchArtwork() {
    busy = true;
    try {
      const result = await window.gameShelf.fetchArtwork(game.id, steamGridDbId.trim() || undefined);
      if (result.ok) artworkPreview = result.value;
      artworkNotice = result.message ?? '';
      onNotice(artworkNotice);
    } catch {
      artworkNotice = 'Could not fetch artwork. Please retry.';
      onNotice(artworkNotice);
    } finally { busy = false; }
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
    } finally { busy = false; }
  }

  async function openLocation(container = false) {
    busy = true;
    try {
      const result = container
        ? await window.gameShelf.openContainerFolder(game.id)
        : await window.gameShelf.openInstallFolder(game.id);
      onNotice(result.message ?? (container ? 'Container folder opened.' : 'Install location opened.'));
    } catch { onNotice(container ? 'Unable to open the container folder. Please retry.' : 'Unable to open the install location. Please retry.'); }
    finally { busy = false; }
  }

  async function clearMetadata() {
    if (!confirm('Clear this game’s provider and manual metadata? It will return to Needs Matching. Custom pasted artwork is kept.')) return;
    busy = true;
    try {
      const result = await window.gameShelf.clearMetadata(game.id);
      publish(result);
      if (result.ok) { resetSearch(); modal = null; }
    } catch { onNotice('Could not clear metadata. Please retry.'); }
    finally { busy = false; }
  }

  async function saveManual(form: HTMLFormElement) {
    busy = true;
    try {
      const result = await window.gameShelf.saveOverrides(game.id, {
        title: (form.elements.namedItem('manual-title') as HTMLInputElement).value,
        description: (form.elements.namedItem('manual-description') as HTMLTextAreaElement).value
      });
      publish(result);
    } catch { onNotice('Could not save manual metadata. Please retry.'); }
    finally { busy = false; }
  }

  async function pasteArtwork(kind: 'cover' | 'background') {
    busy = true;
    try { publish(await window.gameShelf.pasteArtwork(game.id, kind)); }
    catch { onNotice('Could not paste artwork. Please retry.'); }
    finally { busy = false; }
  }

  async function replaceManualWork() {
    if (!confirm('Replace all manual metadata and artwork with the current provider data?')) return;
    busy = true;
    try { publish(await window.gameShelf.replaceAllRescrape(game.id)); }
    catch { onNotice('Could not replace manual work. Please retry.'); }
    finally { busy = false; }
  }

  const date = (value: string) => new Date(value).toLocaleString();
</script>

<section class="details" aria-label="Game details">
  <div class="detail-controls"><div class="edit-menu"><button aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => menuOpen = !menuOpen}>Edit <span aria-hidden="true">⋮</span></button>{#if menuOpen}<div class="edit-menu-items" role="menu"><button role="menuitem" onclick={openMatching}>{game.matchStatus === 'matched' ? 'Change match' : 'Find metadata'}</button><button role="menuitem" onclick={() => { menuOpen = false; modal = 'manual'; }}>Edit metadata & artwork</button>{#if game.matchStatus === 'matched'}<button role="menuitem" onclick={openArtwork}>Fetch artwork</button>{/if}{#if game.providerId === 'igdb'}<button role="menuitem" disabled={busy} onclick={fetchScreenshots}>Fetch screenshots</button>{/if}<button role="menuitem" class="danger" onclick={clearMetadata}>Clear all metadata</button></div>{/if}</div><button class="details-close" aria-label="Close game details" onclick={onClose}>×</button></div>
  <div class="detail-hero" class:has-background={Boolean(game.backgroundUrl)}>
    {#if game.backgroundUrl}<img class="background" src={game.backgroundUrl} alt="" />{/if}
    <div class="detail-heading"><h2>{title}</h2></div>
  </div>
  <div class="detail-aside">{#if game.coverUrl}<img class="cover" src={game.coverUrl} alt={`Cover for ${title}`} />{:else}<div class="cover placeholder" aria-label="No cover artwork available">No cover artwork</div>{/if}{#if collection}<button class="collection-link" onclick={() => onOpenCollection(collection!.id)}><small>Found in collection</small><strong>{collection.displayName || collection.folderName}</strong></button>{/if}{#key `${game.id}:${screenshotRevision}`}<ScreenshotGallery urls={(game.screenshotUrls ?? []).map(url => `${url}?revision=${screenshotRevision}`)} {title} />{/key}</div>
  {#if game.metadata.description}<p class="description">{game.metadata.description}</p>{/if}
  <div class="location-actions"><button class="install" disabled={busy} onclick={() => openLocation()}>▣ Install</button>{#if isSingleFile}<button disabled={busy} onclick={() => openLocation(true)}>▣ Open Container Folder</button>{/if}</div>
  <dl>
    <dt>Metadata match</dt><dd>{game.matchStatus === 'matched' ? `${game.bindingSource} · ${game.providerId} · ${game.providerRecordId}` : 'Needs matching'}</dd>
    {#if game.metadata.releaseYear}<dt>Release year</dt><dd>{game.metadata.releaseYear}</dd>{/if}
    {#if game.metadata.developers?.length}<dt>Developer</dt><dd>{game.metadata.developers.join(', ')}</dd>{/if}
    {#if game.metadata.publishers?.length}<dt>Publisher</dt><dd>{game.metadata.publishers.join(', ')}</dd>{/if}
    {#if game.metadata.genres?.length}<dt>Genres</dt><dd>{game.metadata.genres.join(', ')}</dd>{/if}
    {#if game.metadata.rating !== undefined}<dt>Rating</dt><dd>{game.metadata.rating.toFixed(1)} / 100</dd>{/if}
    <dt>Status</dt><dd>{game.missing ? 'Missing at last scan' : 'Present at last scan'}</dd>
    <dt>Folder within library</dt><dd class="path">{game.relativePath}</dd>
    <dt>Collection</dt><dd>{collection ? collection.displayName || collection.folderName : 'None'}</dd>
    <dt>Added</dt><dd>{date(game.addedAt)}</dd>
    <dt>Last seen</dt><dd>{date(game.lastSeenAt)}</dd>
  </dl>

  {#if modal === 'matching'}<div class="modal-backdrop" role="button" tabindex="0" onclick={() => modal = null} onkeydown={event => { if (event.key === 'Escape' || event.key === 'Enter') modal = null; }}><div class="modal" role="dialog" tabindex="-1" aria-label="Metadata matching" onclick={event => event.stopPropagation()} onkeydown={event => event.stopPropagation()}><button class="close" onclick={() => modal = null}>×</button>
    <section class="matching" aria-label="Metadata matching"><h3>{game.matchStatus === 'matched' ? 'Change match' : 'Find metadata'}</h3><div class="match-context"><strong>{title}</strong><span>Catalog folder: {game.relativePath}</span>{#if game.matchStatus === 'matched'}<span>Current connection: {game.providerId} · record {game.providerRecordId} · {game.bindingSource} match</span>{:else}<span>No metadata match is saved yet.</span>{/if}</div>{#if game.matchStatus === 'unmatched'}<button disabled={busy} onclick={() => match(true)}>Match automatically</button>{/if}<form onsubmit={event => { event.preventDefault(); void searchMatches(); }}><label for="match-query">Search title</label><input id="match-query" bind:value={query} maxlength="250" disabled={busy} required /><label for="match-provider">Search provider</label><select id="match-provider" bind:value={searchProvider} disabled={busy || searchableProviders.length === 0}>{#each searchableProviders as provider}<option value={provider}>{provider}</option>{/each}</select><button disabled={busy || !query.trim()}>Search candidates</button></form>{#if searched}{#if candidates.length === 0}<p class="empty">No results from {searchProvider || 'the selected provider'}. Try another title or provider.</p>{:else}<ul aria-label="Match candidates">{#each candidates as candidate (`${candidate.providerId}:${candidate.recordId}`)}<li class="candidate"><div><strong>{candidate.title}</strong><dl><dt>Release year</dt><dd>{candidate.releaseYear ?? 'Unknown'}</dd><dt>Provider</dt><dd>{candidate.providerId}</dd><dt>Record ID</dt><dd>{candidate.recordId}</dd><dt>Artwork</dt><dd>{candidate.hasArtwork ? 'Available' : 'Not reported by this search'}</dd></dl></div><button class="select-match" disabled={busy} onclick={() => match(false, candidate)}>✓ Select</button></li>{/each}</ul>{/if}{/if}</section>
  </div></div>{/if}
  {#if modal === 'manual'}<div class="modal-backdrop" role="button" tabindex="0" onclick={() => modal = null} onkeydown={event => { if (event.key === 'Escape' || event.key === 'Enter') modal = null; }}><div class="modal" role="dialog" tabindex="-1" aria-label="Manual edits" onclick={event => event.stopPropagation()} onkeydown={event => event.stopPropagation()}><button class="close" onclick={() => modal = null}>×</button><section class="matching" aria-label="Manual edits"><h3>Manual metadata and artwork</h3><form onsubmit={event => { event.preventDefault(); void saveManual(event.currentTarget); }}><label for="manual-title">Title</label><input id="manual-title" name="manual-title" value={game.metadata.title || ''} maxlength="10000" /><label for="manual-description">Description</label><textarea id="manual-description" name="manual-description" maxlength="10000">{game.metadata.description || ''}</textarea><button disabled={busy}>Save manual metadata</button></form><button disabled={busy} onclick={() => pasteArtwork('cover')}>Paste cover from clipboard</button><button disabled={busy} onclick={() => pasteArtwork('background')}>Paste background from clipboard</button><button disabled={busy} onclick={replaceManualWork}>Replace all manual work</button></section></div></div>{/if}
  {#if modal === 'artwork'}<div class="modal-backdrop" role="button" tabindex="0" onclick={() => modal = null} onkeydown={event => { if (event.key === 'Escape' || event.key === 'Enter') modal = null; }}><div class="modal" role="dialog" tabindex="-1" aria-label="Fetch artwork" onclick={event => event.stopPropagation()} onkeydown={event => event.stopPropagation()}><button class="close" onclick={() => modal = null}>×</button><section class="matching artwork-modal" aria-label="Fetch artwork"><h3>Fetch artwork</h3>{#if artworkPreview}<p class="muted">Confirm to replace the artwork below. “Manual” means an image pasted through Edit metadata & artwork.</p><div class="artwork-preview">{#each artworkPreview.items as item (item.kind)}<section><h4>{item.kind === 'cover' ? 'Cover' : 'Background'}</h4><div class="artwork-comparison"><div><strong>Current{item.currentSource === 'manual' ? ' · manual' : ''}</strong>{#if item.currentUrl}<img src={item.currentUrl} alt={`Current ${item.kind}`} />{:else}<span class="preview-placeholder">No current artwork</span>{/if}</div><div><strong>New</strong><img src={item.proposedUrl} alt={`New ${item.kind}`} /></div></div></section>{/each}</div><button class="primary" disabled={busy} onclick={confirmArtwork}>Replace artwork</button><button disabled={busy} onclick={() => { artworkPreview = null; artworkNotice = ''; }}>Cancel</button>{:else}<p class="muted">Downloads available cover and background art for review. It does not replace anything until you confirm.</p><label for="steamgrid-id">SteamGridDB game ID <small>Optional; title lookup is used when blank.</small></label><input id="steamgrid-id" bind:value={steamGridDbId} inputmode="numeric" pattern="[0-9]*" maxlength="19" placeholder="Optional SteamGridDB ID" /><button disabled={busy} onclick={fetchArtwork}>▧ Fetch artwork</button>{/if}{#if artworkNotice}<p class="artwork-notice" role="status">{artworkNotice}</p>{/if}</section></div></div>{/if}
</section>

<style>
  .details { position: relative; padding: 20px; border: 1px solid #394154; border-radius: 10px; background: #202633; }
  h2 { font-size: 18px; margin: 0 0 12px; overflow-wrap: anywhere; } h3 { font-size: 15px; margin: 0 0 10px; } p { color: #bcc5d5; line-height: 1.5; } .muted { font-size: 13px; color: #bcc5d5; }
  button { padding: 9px 12px; border: 1px solid #566380; border-radius: 6px; background: #293246; color: #edf0f6; font: inherit; font-size: 13px; cursor: pointer; text-align: left; } button:hover { background: #35446a; } button:disabled { opacity: .5; cursor: default; } button:focus-visible { outline: 2px solid #aabaff; outline-offset: 3px; }.primary { background: #435caa; border-color: #788bce; }.danger { background: #7f2e3a; border-color: #d67783; color: #fff; }.danger:hover { background: #983846; } ul { list-style: none; padding: 0; margin: 0; }
  .details button { margin-top: 8px; }
  .detail-controls { position: absolute; z-index: 4; top: 8px; right: 8px; display: flex; align-items: stretch; gap: 8px; }
  .detail-controls > button, .edit-menu > button { height: 34px; margin: 0; }
  .details-close { padding: 0 11px; font-size: 14px; }
  .detail-hero { position: relative; margin-bottom: 12px; }.detail-hero.has-background { min-height: 150px; display: flex; align-items: end; overflow: hidden; border-radius: 6px; }.detail-heading { position: relative; z-index: 1; display: flex; align-items: start; gap: 12px; width: 100%; padding-right: 132px; }.detail-hero.has-background .detail-heading { padding: 38px 14px 14px; background: linear-gradient(transparent, rgb(10 14 20 / .92)); }.detail-hero.has-background h2 { color: #fff; text-shadow: 0 2px 8px #000; }.detail-heading h2 { margin-right: auto; }
  .detail-aside { float: right; width: min(300px, 42%); margin: 0 0 12px 18px; }.cover { width: 100%; height: auto; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 6px; border: 1px solid #566380; }.collection-link { display: grid; width: 100%; gap: 3px; margin: 10px 0 0 !important; padding: 10px 12px; border-color: #677ab4; background: #273451; }.collection-link small { margin: 0; color: #b8c8ff; }.collection-link strong { overflow-wrap: anywhere; }.placeholder { min-height: 140px; display: grid; place-items: center; padding: 8px; color: #a5b0c6; font-size: 12px; text-align: center; background: #171b24; }.background { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .58; }.description { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }.location-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }.location-actions button { margin: 0; }.install { background: #276a48; border-color: #62ae82; font-weight: 700; }.install:hover { background: #348158; }
  dt { color: #a5b0c6; font-size: 12px; margin-top: 14px; } dd { margin: 4px 0 0; font-size: 13px; overflow-wrap: anywhere; }.path { overflow-wrap: anywhere; }
  .matching { border-top: 1px solid #394154; margin-top: 20px; padding-top: 8px; }.matching h3 { font-size: 15px; }.match-context { display: grid; gap: 4px; margin: 12px 0; padding: 12px; border: 1px solid #4c5b78; border-radius: 7px; background: #171d29; }.match-context span { color: #bcc5d5; font-size: 12px; overflow-wrap: anywhere; }.matching label { display: block; margin: 16px 0 6px; font-size: 13px; }.matching input, .matching select, .matching textarea, .artwork-modal input { width: 100%; padding: 8px; background: #171b24; color: #edf0f6; border: 1px solid #566380; border-radius: 4px; }.matching textarea { min-height: 80px; }.matching li { margin-top: 12px; border-top: 1px solid #394154; padding-top: 8px; }.candidate { display: flex; align-items: end; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid #394154; border-radius: 7px; background: #171d29; }.candidate > div { min-width: 0; flex: 1; }.candidate .select-match { width: auto; min-width: 0; flex: none; align-self: end; white-space: nowrap; }.candidate dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 8px; margin: 8px 0 0; }.candidate dt, .candidate dd { margin: 0; font-size: 12px; }.candidate dt { color: #a5b0c6; }
  .edit-menu { position: relative; }.edit-menu > button { display: inline-flex; align-items: center; gap: 8px; }.edit-menu > button span { font-size: 18px; line-height: .6; }.edit-menu-items { position: absolute; top: 100%; right: 0; display: grid; min-width: 190px; margin-top: 6px; padding: 6px; border: 1px solid #566380; border-radius: 7px; background: #202633; box-shadow: 0 10px 30px #0008; }.edit-menu-items button { width: 100%; margin: 0; }.modal-backdrop { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: 20px; background: rgb(0 0 0 / .6); }.modal { position: relative; width: min(620px, 100%); max-height: 85vh; overflow: auto; padding: 24px; border: 1px solid #566380; border-radius: 10px; background: #202633; box-shadow: 0 20px 60px #000; }.modal .matching { margin-top: 0; }.close { float: right; font-size: 20px; padding: 2px 9px; }.artwork-modal small { color: #bcc5d5; font-size: 11px; }.artwork-notice { padding: 10px; border: 1px solid #4c5b78; border-radius: 6px; background: #171d29; font-size: 13px; }.artwork-preview { display: grid; gap: 14px; margin: 16px 0; }.artwork-preview section { border: 1px solid #394154; border-radius: 7px; padding: 12px; }.artwork-preview h4 { margin: 0 0 8px; font-size: 13px; }.artwork-comparison { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }.artwork-comparison > div { display: grid; gap: 6px; min-width: 0; }.artwork-comparison strong { font-size: 12px; color: #bcc5d5; }.artwork-comparison img, .preview-placeholder { width: 100%; height: 160px; object-fit: cover; border: 1px solid #566380; border-radius: 5px; background: #171b24; }.preview-placeholder { display: grid; place-items: center; padding: 8px; color: #a5b0c6; font-size: 12px; text-align: center; }
</style>
