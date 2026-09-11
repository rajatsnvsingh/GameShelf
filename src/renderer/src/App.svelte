<script lang="ts">
  import { onMount } from 'svelte';
  import CollectionCard from './components/CollectionCard.svelte';
  import GameCard from './components/GameCard.svelte';
  import type {
    ArtworkPreview,
    CatalogGame,
    CatalogView,
    LibraryState,
    MatchCandidate,
    MatchingStatus,
    SettingsView
  } from '../../shared/api';

  type Page = 'home' | 'games' | 'collections' | 'settings';
  type SettingsTab = 'general' | 'library' | 'providers';
  type DetailModal = 'matching' | 'manual' | 'artwork' | null;
  type CollectionBack = {
    page: Page;
    collectionId: number | null;
    needsMatching: boolean;
  };

  // Application data loaded from the privileged preload bridge.
  let version = $state('');
  let library = $state<LibraryState>();
  let catalog = $state<CatalogView>({ games: [], collections: [] });
  let settings = $state<SettingsView>();
  let matchingStatus = $state<MatchingStatus>({
    phase: 'idle',
    attempted: 0,
    total: 0,
    matched: 0
  });

  // Transient view state. None of this state is persisted with the catalog.
  let busy = $state(false);
  let notice = $state('');
  let page = $state<Page>('home');
  let settingsTab = $state<SettingsTab>('general');
  let collectionId = $state<number | null>(null);
  let selectedId = $state<number | null>(null);
  let needsMatching = $state(false);
  let titleFilter = $state('');
  let yearFilter = $state('');
  let collectionFilter = $state('all');
  let genreFilter = $state('');
  let sort = $state<'title' | 'releaseDate'>('title');
  let homeGroupBy = $state<'decade' | 'genre'>('decade');
  let query = $state('');
  let searchProvider = $state('');
  let steamGridDbId = $state('');
  let artworkNotice = $state('');
  let artworkPreview = $state<ArtworkPreview | null>(null);
  let candidates = $state<MatchCandidate[]>([]);
  let candidateGameId = $state<number | null>(null);
  let detailModal = $state<DetailModal>(null);
  let detailMenu = $state(false);

  let collectionBack = $state<CollectionBack | null>(null);

  const gameTitle = (game: CatalogGame) => game.metadata.title || game.displayName;
  const resetCandidateSearch = () => {
    candidates = [];
    candidateGameId = null;
  };
  const isMatchingGame = (game: CatalogGame) => !needsMatching || game.matchStatus === 'unmatched';
  const matchesCollectionFilter = (game: CatalogGame) => {
    if (collectionId !== null && game.collectionId !== collectionId) return false;
    if (collectionFilter === 'all') return true;
    if (collectionFilter === 'none') return game.collectionId === null;
    return game.collectionId === Number(collectionFilter);
  };
  const matchesMetadataFilters = (game: CatalogGame) => {
    const title = gameTitle(game).toLocaleLowerCase();

    return (
      (!yearFilter || String(game.metadata.releaseYear ?? '') === yearFilter) &&
      (!genreFilter || game.metadata.genres?.includes(genreFilter)) &&
      (!titleFilter || title.includes(titleFilter.toLocaleLowerCase()))
    );
  };
  const sortByTitle = (left: CatalogGame, right: CatalogGame) => gameTitle(left).localeCompare(gameTitle(right));
  const sortGames = (items: CatalogGame[]) => items.sort((left, right) => {
    if (sort === 'title') return sortByTitle(left, right);

    return (right.metadata.releaseYear ?? -1) - (left.metadata.releaseYear ?? -1) || sortByTitle(left, right);
  });

  const collection = $derived(catalog.collections.find(item => item.id === collectionId));
  const games = $derived(sortGames(catalog.games.filter(game =>
    isMatchingGame(game) && matchesCollectionFilter(game) && matchesMetadataFilters(game)
  )));
  const years = $derived(
    [...new Set(catalog.games.flatMap(game => game.metadata.releaseYear ? [game.metadata.releaseYear] : []))]
      .sort((left, right) => right - left)
  );
  const genres = $derived(
    [...new Set(catalog.games.flatMap(game => game.metadata.genres ?? []))]
      .sort((left, right) => left.localeCompare(right))
  );
  const selected = $derived(catalog.games.find(game => game.id === selectedId));
  const selectedCollection = $derived(
    selected?.collectionId === null || selected?.collectionId === undefined
      ? undefined
      : catalog.collections.find(item => item.id === selected.collectionId)
  );
  const selectedIsSingleFile = $derived(Boolean(selected && /\.(zip|rar|iso|exe)$/iu.test(selected.relativePath)));
  const searchableProviders = $derived(
    (settings?.providerOrder ?? []).filter(id =>
      id !== 'steamgriddb' && settings?.providers[id]?.enabled && settings.providers[id]?.configured
    )
  );
  const recentlyAdded = $derived.by(() => {
    const firstAddedAt = catalog.games.reduce(
      (earliest, game) => !earliest || game.addedAt < earliest ? game.addedAt : earliest,
      ''
    );

    return catalog.games
      .filter(game => firstAddedAt && game.addedAt > firstAddedAt)
      .sort((left, right) => right.addedAt.localeCompare(left.addedAt) || sortByTitle(left, right));
  });
  const homeGroups = $derived.by(() => {
    const groups = new Map<string, CatalogView['games']>();

    for (const game of catalog.games) {
      const labels = homeGroupBy === 'decade'
        ? [game.metadata.releaseYear ? `${Math.floor(game.metadata.releaseYear / 10) * 10}s` : 'Unknown release date']
        : game.metadata.genres?.length ? game.metadata.genres : ['Uncategorized'];

      for (const label of labels) groups.set(label, [...(groups.get(label) ?? []), game]);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => homeGroupBy === 'decade'
        ? (left === 'Unknown release date' ? 1 : right === 'Unknown release date' ? -1 : right.localeCompare(left))
        : left.localeCompare(right))
      .map(([label, items]) => ({ label, games: items.sort(sortByTitle) }));
  });

  const collectionName = (id: number | null) => {
    const item = catalog.collections.find(item => item.id === id);
    return item ? item.displayName || item.folderName : 'None';
  };
  const date = (value: string) => new Date(value).toLocaleString();

  function selectGame(id: number) {
    selectedId = id;
    query = catalog.games.find(game => game.id === id)?.displayName ?? '';
    resetCandidateSearch();
    detailMenu = false;
  }

  function openCollection(id: number) {
    collectionBack = { page, collectionId, needsMatching };
    page = 'collections';
    needsMatching = false;
    collectionId = id;
  }

  function backFromCollection() {
    const previous = collectionBack;

    collectionBack = null;
    page = previous?.page ?? 'collections';
    collectionId = previous?.collectionId ?? null;
    needsMatching = previous?.needsMatching ?? false;
  }

  function openCollectionsOverview() {
    collectionBack = null;
    page = 'collections';
    needsMatching = false;
    collectionId = null;
  }

  function openMatching() {
    if (!selected) return;

    query = selected.metadata.title || selected.displayName;
    searchProvider = searchableProviders[0] ?? '';
    resetCandidateSearch();
    detailMenu = false;
    detailModal = 'matching';
  }

  function openArtwork() {
    artworkNotice = '';
    artworkPreview = null;
    detailMenu = false;
    detailModal = 'artwork';
  }

  async function match(automatic: boolean, candidate?: MatchCandidate) {
    if (!selected) return;

    const id = selected.id;
    busy = true;
    notice = automatic ? 'Finding a confident match…' : 'Retrieving and saving metadata…';

    try {
      const result = automatic
        ? await window.gameShelf.autoMatch(id)
        : await window.gameShelf.selectMatch(id, candidate!.providerId, candidate!.recordId);

      if (result.ok) {
        catalog = result.value;
        resetCandidateSearch();
        if (result.value.games.find(game => game.id === id)?.matchStatus === 'matched') detailModal = null;
      }

      notice = result.message ?? 'Match saved.';
    } catch {
      notice = 'Matching failed. Please retry.';
    } finally {
      busy = false;
    }
  }

  async function searchMatches() {
    if (!selected) return;

    const id = selected.id;
    busy = true;
    resetCandidateSearch();
    notice = 'Searching the selected metadata provider…';

    try {
      const result = await window.gameShelf.searchMatches(id, query, searchProvider || undefined);

      if (result.ok && selectedId === id) {
        candidates = result.value.candidates;
        candidateGameId = id;
      }

      notice = result.message ?? '';
    } catch {
      notice = 'Search failed. Please retry.';
    } finally {
      busy = false;
    }
  }

  async function refresh(choose = false) {
    busy = true;
    notice = '';

    try {
      library = await (choose ? window.gameShelf.chooseLibraryRoot() : window.gameShelf.getLibraryState());
      const result = await window.gameShelf.getCatalog();

      if (result.ok) catalog = result.value;
      else notice = library?.message.includes('Rebuild catalog') ? library.message : result.message;
    } catch {
      notice = 'Unable to load the library. Please retry.';
    } finally {
      busy = false;
    }
  }

  async function scan() {
    busy = true;
    notice = 'Scanning library, then matching unresolved games…';
    resetCandidateSearch();
    await refreshMatchingStatus();
    const progressTimer = setInterval(() => { void refreshMatchingStatus(); }, 300);

    try {
      const result = await window.gameShelf.scanLibrary();

      if (result.ok) catalog = result.value;
      notice = result.message ?? 'Scan complete.';
      library = await window.gameShelf.getLibraryState();
      const settingsResult = await window.gameShelf.getSettings();

      if (settingsResult.ok) settings = settingsResult.value;
    } catch {
      notice = 'Unable to complete the scan. Please retry.';
    } finally {
      clearInterval(progressTimer);
      await refreshMatchingStatus();
      busy = false;
    }
  }

  async function refreshMatchingStatus() {
    try {
      matchingStatus = await window.gameShelf.getMatchingStatus();
    } catch {
      // Status is nonessential UI feedback.
    }
  }

  async function fetchArtwork() {
    if (!selected) return;

    busy = true;

    try {
      const result = await window.gameShelf.fetchArtwork(selected.id, steamGridDbId.trim() || undefined);

      if (result.ok) artworkPreview = result.value;
      artworkNotice = result.message ?? '';
      notice = artworkNotice;
    } catch {
      artworkNotice = 'Could not fetch artwork. Please retry.';
      notice = artworkNotice;
    } finally {
      busy = false;
    }
  }

  async function confirmArtwork() {
    if (!selected) return;

    busy = true;

    try {
      const result = await window.gameShelf.confirmArtwork(selected.id);

      if (result.ok) {
        catalog = result.value;
        artworkPreview = null;
      }

      artworkNotice = result.message ?? '';
      notice = artworkNotice;
    } catch {
      artworkNotice = 'Could not replace artwork. Please retry.';
      notice = artworkNotice;
    } finally {
      busy = false;
    }
  }

  async function openLocation(open: (gameId: number) => ReturnType<typeof window.gameShelf.openInstallFolder>, success: string, failure: string) {
    if (!selected) return;

    busy = true;

    try {
      const result = await open(selected.id);
      notice = result.message ?? success;
    } catch {
      notice = failure;
    } finally {
      busy = false;
    }
  }

  async function openFolder() {
    await openLocation(
      gameId => window.gameShelf.openInstallFolder(gameId),
      'Install location opened.',
      'Unable to open the install location. Please retry.'
    );
  }

  async function openContainerFolder() {
    await openLocation(
      gameId => window.gameShelf.openContainerFolder(gameId),
      'Container folder opened.',
      'Unable to open the container folder. Please retry.'
    );
  }

  async function clearMetadata() {
    if (!selected || !confirm('Clear this game’s provider and manual metadata? It will return to Needs Matching. Custom pasted artwork is kept.')) return;

    busy = true;

    try {
      const result = await window.gameShelf.clearMetadata(selected.id);

      if (result.ok) {
        catalog = result.value;
        resetCandidateSearch();
        detailModal = null;
      }

      notice = result.message ?? '';
    } catch {
      notice = 'Could not clear metadata. Please retry.';
    } finally {
      busy = false;
    }
  }

  async function saveSettings(form: HTMLFormElement) {
    const get = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
    const checked = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).checked;
    const result = await window.gameShelf.saveSettings({
      collectionPrefix: get('prefix'),
      showCollectionGames: checked('visible'),
      matchingThreshold: Number(get('threshold')),
      greedyMatch: checked('greedy-match'),
      defaultSort: get('sort') as 'title' | 'releaseDate',
      providerOrder: get('order').split(',').map(id => id.trim()).filter(Boolean),
      providers: {
        igdb: { enabled: checked('igdb'), configured: settings!.providers.igdb.configured },
        thegamesdb: { enabled: checked('thegamesdb'), configured: settings!.providers.thegamesdb.configured },
        steamgriddb: { enabled: checked('steamgriddb'), configured: settings!.providers.steamgriddb.configured }
      },
      credentials: {
        igdbClientId: get('igdb-client'),
        igdbClientSecret: get('igdb-secret'),
        thegamesdbApiKey: get('thegamesdb-key'),
        steamgriddbApiKey: get('steamgriddb-key')
      }
    });

    if (result.ok) settings = result.value;
    notice = result.ok ? 'Settings saved.' : result.message;
  }

  onMount(() => {
    window.gameShelf
      .getAppInfo()
      .then(info => { version = info.version; })
      .catch(() => { notice = 'Unable to read app information.'; });
    void refresh();
    void refreshMatchingStatus();
    window.gameShelf.getSettings().then(result => {
      if (result.ok) settings = result.value;
    });

    const keys = (event: KeyboardEvent) => {
      const isEditing = event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement;
      const isArrowKey = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key);

      if (isEditing || !isArrowKey || !games.length) return;

      event.preventDefault();

      const current = Math.max(0, games.findIndex(game => game.id === selectedId));
      const columns = Math.max(1, Math.floor((window.innerWidth - 300) / 152));
      const offset = event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowUp'
            ? -columns
            : columns;
      const next = Math.max(0, Math.min(games.length - 1, current + offset));

      selectGame(games[next].id);
    };

    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  });
</script>

<main class="app-shell">
  <aside class="sidebar">
  <header>
    <div><p class="eyebrow">YOUR PORTABLE GAME CATALOG</p><h1>GameShelf</h1></div>
    <p class="version">{version ? `Version ${version}` : ''}</p>
  </header>

  <nav class="pages" aria-label="Library views">
    <button class:active={page === 'home'} aria-pressed={page === 'home'} onclick={() => { page = 'home'; needsMatching = false; collectionId = null; }}>⌂ <span>Home</span></button>
    <button class:active={page === 'games'} aria-pressed={page === 'games'} onclick={() => { page = 'games'; needsMatching = false; collectionId = null; }}>▦ <span>All Games</span></button>
    <button class:active={page === 'collections'} aria-pressed={page === 'collections'} onclick={openCollectionsOverview}>▤ <span>Collections</span></button>
  </nav>

  <section class="status-card sidebar-status" aria-label="Library status"><div><strong>{catalog.games.length}</strong><span>Games</span></div><div><strong>{catalog.collections.length}</strong><span>Collections</span></div><button onclick={() => { page = 'games'; needsMatching = true; collectionId = null; }}><strong>{catalog.games.filter(game => game.matchStatus === 'unmatched').length}</strong><span>Needs matching</span></button></section>
  <section class="matching-status" aria-label="Matching status"><strong>{matchingStatus.phase === 'matching' ? `Matching ${matchingStatus.attempted}/${matchingStatus.total}` : matchingStatus.phase === 'scanning' ? 'Scanning library' : matchingStatus.phase === 'complete' ? 'Matching complete' : 'Matching ready'}</strong><span>{matchingStatus.message || 'Run Scan library in Settings to match unresolved games.'}</span>{#if matchingStatus.gameName && matchingStatus.phase === 'matching'}<small>{matchingStatus.gameName} · {matchingStatus.matched} matched</small>{/if}</section>
  {#if notice}<p class="sidebar-notice" role="status" aria-live="polite">{notice}</p>{/if}
  <div class="sidebar-footer">
    <button class="settings-link" class:active={page === 'settings'} aria-pressed={page === 'settings'} onclick={() => page = 'settings'}>⚙ <span>Settings</span></button>
    <a class="author-link" href="https://github.com/rajatsnvsingh" target="_blank" rel="noreferrer">Made with ❤️ by Rajat Singh</a>
  </div>
  </aside>

  <section class="workspace">

  {#if page === 'settings' && settings}
    <section class="setup settings-panel" aria-label="Settings"><h2>Settings</h2>
      <div class="settings-tabs" role="tablist" aria-label="Settings sections">
        <button type="button" role="tab" aria-selected={settingsTab === 'general'} class:active={settingsTab === 'general'} onclick={() => settingsTab = 'general'}>General</button>
        <button type="button" role="tab" aria-selected={settingsTab === 'library'} class:active={settingsTab === 'library'} onclick={() => settingsTab = 'library'}>Library</button>
        <button type="button" role="tab" aria-selected={settingsTab === 'providers'} class:active={settingsTab === 'providers'} onclick={() => settingsTab = 'providers'}>Providers</button>
      </div>
      <form class="settings-form" onsubmit={event => { event.preventDefault(); void saveSettings(event.currentTarget); }}>
        <div class="settings-tab-panel" role="tabpanel" aria-label="General settings" hidden={settingsTab !== 'general'}>
          <h3>General</h3><label>Default sort <select name="sort" value={settings.defaultSort}><option value="title">Title</option><option value="releaseDate">Release date</option></select></label>
        </div>
        <div class="settings-tab-panel" role="tabpanel" aria-label="Library settings" hidden={settingsTab !== 'library'}>
          <h3>Library</h3><section class="library-setup" aria-label="Library setup"><h3>{library?.status === 'ready' ? 'Library ready' : library?.status === 'unavailable' ? 'Library unavailable' : 'Choose your library'}</h3>{#if library?.root}<p class="path">{library.root}</p>{/if}<div class="settings-actions"><button type="button" class="primary" disabled={busy || library?.status !== 'ready'} onclick={scan}>Scan library</button><button type="button" disabled={busy || !library || library.status === 'config-error'} onclick={() => refresh(true)}>Choose library folder</button><button type="button" disabled={busy} onclick={() => refresh()}>Retry</button></div><p class="muted">{library?.message || 'Loading…'}</p></section>
          <label>Collection prefix <input name="prefix" value={settings.collectionPrefix} /></label><label class="checkbox-label"><input name="visible" type="checkbox" checked={settings.showCollectionGames} /> Show collection games in main library</label>
          <section class="matching catalog-maintenance"><h3>Catalog maintenance</h3><p class="muted">These actions affect catalog records only. They never alter installer folders.</p><div class="settings-actions"><button type="button" onclick={async () => { if (!confirm('Remove all records currently marked missing? This cannot be undone.')) return; const result = await window.gameShelf.deleteMissing(); if (result.ok) catalog = result.value; notice = result.message || ''; }}>Remove missing records</button><button type="button" onclick={async () => { if (!confirm('Rebuild the catalog from the selected library? This removes saved matches, manual metadata, and artwork associations.')) return; const result = await window.gameShelf.rebuildCatalog(); if (result.ok) catalog = result.value; notice = result.message || ''; }}>Rebuild catalog</button><button type="button" class="danger" onclick={async () => { if (!confirm('Wipe all catalog records, cached artwork, and logs? Your library selection, settings, provider credentials, game folders, and archives will not be changed.')) return; const result = await window.gameShelf.wipeLibrary(); if (result.ok) { catalog = { games: [], collections: [] }; library = await window.gameShelf.getLibraryState(); const current = await window.gameShelf.getSettings(); if (current.ok) settings = current.value; } notice = result.message || ''; }}>Wipe library</button></div></section>
        </div>
        <div class="settings-tab-panel" role="tabpanel" aria-label="Provider settings" hidden={settingsTab !== 'providers'}>
          <h3>Providers</h3><p class="muted">Credentials are never shown after saving.</p><label>Matching threshold <input name="threshold" type="number" min="0" max="1" step="0.01" value={settings.matchingThreshold} /></label><label class="greedy-match"><input name="greedy-match" type="checkbox" checked={settings.greedyMatch} /> Greedy match <small>Always accept the first result ranked by the first provider that returns one.</small></label><label>Provider order <input name="order" value={settings.providerOrder.join(',')} /></label>
          <fieldset><legend>Provider credentials</legend><label><input name="igdb" type="checkbox" checked={settings.providers.igdb.enabled} /> IGDB {settings.providers.igdb.configured ? 'configured' : 'not configured'}</label><input name="igdb-client" placeholder="New IGDB client ID" /><input name="igdb-secret" type="password" placeholder="New IGDB client secret" /><label><input name="thegamesdb" type="checkbox" checked={settings.providers.thegamesdb.enabled} /> TheGamesDB {settings.providers.thegamesdb.configured ? 'configured' : 'not configured'}</label><input name="thegamesdb-key" type="password" placeholder="New TheGamesDB API key" /><label><input name="steamgriddb" type="checkbox" checked={settings.providers.steamgriddb.enabled} /> SteamGridDB {settings.providers.steamgriddb.configured ? 'configured' : 'not configured'}</label><input name="steamgriddb-key" type="password" placeholder="New SteamGridDB API key" /><p class="muted">SteamGridDB supplies cover and banner art only. After a game is matched, use Fetch artwork on its details page to request missing assets.</p></fieldset>
        </div>
        <button class="primary save-settings">Save settings</button>
      </form>
    </section>
  {:else}
  <div class="catalog" class:detail-open={selected !== undefined} aria-busy={busy}>
    <nav aria-label="Collections">
      <h2>Collections</h2>
      <button class:active={collectionId === null && !needsMatching} aria-pressed={collectionId === null && !needsMatching}
        onclick={() => { page = 'games'; needsMatching = false; collectionId = null; selectedId = null; }}>All games <span>{catalog.games.length}</span></button>
      <button class:active={needsMatching} aria-pressed={needsMatching}
        onclick={() => { page = 'games'; needsMatching = true; collectionId = null; selectedId = null; }}>Needs Matching <span>{catalog.games.filter(game => game.matchStatus === 'unmatched').length}</span></button>
      {#each catalog.collections as item (item.id)}
        <button class:active={collectionId === item.id} aria-pressed={collectionId === item.id}
          onclick={() => openCollection(item.id)}>
          {item.displayName || item.folderName}
          <span>{catalog.games.filter(game => game.collectionId === item.id).length}</span>
          {#if item.missing}<small class="missing">Missing</small>{/if}
        </button>
      {/each}
      {#if catalog.collections.length === 0}<p class="muted">No collections yet.</p>{/if}
    </nav>

    <section class="game-list" aria-label="Games">
      {#if page === 'home'}<div class="home"><h2>Home</h2><section class="home-section"><h3>Collections</h3>{#if catalog.collections.length === 0}<p class="empty">No collections yet.</p>{:else}<div class="collection-grid">{#each catalog.collections as item (item.id)}{@const artwork = catalog.games.find(game => game.collectionId === item.id && game.coverUrl)?.coverUrl}<CollectionCard collection={item} {artwork} onOpen={openCollection} />{/each}</div>{/if}</section>{#if recentlyAdded.length}<section class="home-section"><h3>Recently added</h3><div class="game-grid home-grid">{#each recentlyAdded as game (game.id)}<GameCard {game} showAddedAt onSelect={selectGame} />{/each}</div></section>{/if}<section class="home-section"><div class="group-heading"><h3>Library</h3><label>Group by <select bind:value={homeGroupBy}><option value="decade">Release decade</option><option value="genre">Genre</option></select></label></div>{#if homeGroups.length === 0}<p class="empty">No games yet. Choose your folder, then select Scan library.</p>{:else}{#each homeGroups as group (group.label)}<section class="home-group"><h3>{group.label} <span class="count">{group.games.length}</span></h3><div class="game-grid home-grid">{#each group.games as game (game.id)}<GameCard {game} showGenreYear={homeGroupBy === 'genre'} onSelect={selectGame} />{/each}</div></section>{/each}{/if}</section></div>{/if}
      {#if page === 'collections' && collectionId === null}<div class="home"><h2>Collections</h2>{#if catalog.collections.length === 0}<p class="empty">No collections yet.</p>{:else}<div class="collection-grid">{#each catalog.collections as item (item.id)}{@const artwork = catalog.games.find(game => game.collectionId === item.id && game.coverUrl)?.coverUrl}<CollectionCard collection={item} {artwork} onOpen={openCollection} />{/each}</div>{/if}</div>{/if}
      {#if page === 'games' || (page === 'collections' && collectionId !== null)}
      <div class="filters" aria-label="Game filters"><label class="search-filter"><span class="search-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg></span><input bind:value={titleFilter} placeholder="Search your library" /></label><label>Year <select bind:value={yearFilter}><option value="">All years</option>{#each years as year}<option value={String(year)}>{year}</option>{/each}</select></label><label>Genre <select bind:value={genreFilter}><option value="">All genres</option>{#each genres as genre}<option value={genre}>{genre}</option>{/each}</select></label><label>Collection <select bind:value={collectionFilter}><option value="all">All collections</option><option value="none">No collection</option>{#each catalog.collections as item}<option value={String(item.id)}>{item.displayName || item.folderName}</option>{/each}</select></label><label>Sort <select bind:value={sort}><option value="title">Title</option><option value="releaseDate">Release date</option></select></label></div>
      <div class="list-heading">{#if page === 'collections' && collection}<button class="back" onclick={backFromCollection}>← Back</button>{/if}<h2>{needsMatching ? 'Needs Matching' : collection ? collection.displayName || collection.folderName : 'All games'} <span class="count">{games.length}</span></h2></div>
      {#if games.length === 0}
        <p class="empty">{needsMatching ? 'No games need matching.' : collection ? 'This collection has no cataloged games.' : 'No games yet. Choose your folder, then select Scan library.'}</p>
      {:else}
        <ul class="game-grid">
          {#each games as game (game.id)}
            <li><GameCard {game} active={selectedId === game.id} showMetadata collectionName={game.collectionId !== null ? collectionName(game.collectionId) : undefined} onSelect={selectGame} /></li>
          {/each}
        </ul>
      {/if}
      {/if}
    </section>

    {#if selected}<section class="details" aria-label="Game details">
        <div class="detail-controls"><div class="edit-menu"><button aria-haspopup="menu" aria-expanded={detailMenu} onclick={() => detailMenu = !detailMenu}>Edit <span aria-hidden="true">⋮</span></button>{#if detailMenu}<div class="edit-menu-items" role="menu"><button role="menuitem" onclick={openMatching}>{selected.matchStatus === 'matched' ? 'Change match' : 'Find metadata'}</button><button role="menuitem" onclick={() => { detailMenu = false; detailModal = 'manual'; }}>Edit metadata & artwork</button>{#if selected.matchStatus === 'matched'}<button role="menuitem" onclick={openArtwork}>Fetch artwork</button>{/if}<button role="menuitem" class="danger" onclick={clearMetadata}>Clear all metadata</button></div>{/if}</div><button class="close details-close" aria-label="Close game details" onclick={() => { selectedId = null; detailModal = null; detailMenu = false; }}>×</button></div>
        <div class="detail-hero" class:has-background={Boolean(selected.backgroundUrl)}>
          {#if selected.backgroundUrl}<img class="background" src={selected.backgroundUrl} alt="" />{/if}
          <div class="detail-heading"><h2>{selected.metadata.title || selected.folderName}</h2></div>
        </div>
        <div class="detail-aside">{#if selected.coverUrl}<img class="cover" src={selected.coverUrl} alt={`Cover for ${selected.metadata.title || selected.folderName}`} />{:else}<div class="cover placeholder" aria-label="No cover artwork available">No cover artwork</div>{/if}{#if selectedCollection}<button class="collection-link" onclick={() => openCollection(selectedCollection.id)}><small>Found in collection</small><strong>{selectedCollection.displayName || selectedCollection.folderName}</strong></button>{/if}</div>
        {#if selected.metadata.description}<p class="description">{selected.metadata.description}</p>{/if}
        <div class="location-actions"><button class="install" disabled={busy} onclick={openFolder}>▣ Install</button>{#if selectedIsSingleFile}<button disabled={busy} onclick={openContainerFolder}>▣ Open Container Folder</button>{/if}</div>
        <dl>
          <dt>Metadata match</dt><dd>{selected.matchStatus === 'matched' ? `${selected.bindingSource} · ${selected.providerId} · ${selected.providerRecordId}` : 'Needs matching'}</dd>
          {#if selected.metadata.releaseYear}<dt>Release year</dt><dd>{selected.metadata.releaseYear}</dd>{/if}
          {#if selected.metadata.developers?.length}<dt>Developer</dt><dd>{selected.metadata.developers.join(', ')}</dd>{/if}
          {#if selected.metadata.publishers?.length}<dt>Publisher</dt><dd>{selected.metadata.publishers.join(', ')}</dd>{/if}
          {#if selected.metadata.genres?.length}<dt>Genres</dt><dd>{selected.metadata.genres.join(', ')}</dd>{/if}
          {#if selected.metadata.rating !== undefined}<dt>Rating</dt><dd>{selected.metadata.rating.toFixed(1)} / 100</dd>{/if}
          <dt>Status</dt><dd>{selected.missing ? 'Missing at last scan' : 'Present at last scan'}</dd>
          <dt>Folder within library</dt><dd class="path">{selected.relativePath}</dd>
          <dt>Collection</dt><dd>{collectionName(selected.collectionId)}</dd>
          <dt>Added</dt><dd>{date(selected.addedAt)}</dd>
          <dt>Last seen</dt><dd>{date(selected.lastSeenAt)}</dd>
        </dl>
        {#if detailModal === 'matching'}<div class="modal-backdrop" role="button" tabindex="0" onclick={() => detailModal = null} onkeydown={event => { if (event.key === 'Escape' || event.key === 'Enter') detailModal = null; }}><div class="modal" role="dialog" tabindex="-1" aria-label="Metadata matching" onclick={event => event.stopPropagation()} onkeydown={event => event.stopPropagation()}><button class="close" onclick={() => detailModal = null}>×</button>
        <section class="matching" aria-label="Metadata matching">
          <h3>{selected.matchStatus === 'matched' ? 'Change match' : 'Find metadata'}</h3>
          <div class="match-context"><strong>{selected.metadata.title || selected.folderName}</strong><span>Catalog folder: {selected.relativePath}</span>{#if selected.matchStatus === 'matched'}<span>Current connection: {selected.providerId} · record {selected.providerRecordId} · {selected.bindingSource} match</span>{:else}<span>No metadata match is saved yet.</span>{/if}</div>
          {#if selected.matchStatus === 'unmatched'}<button disabled={busy} onclick={() => match(true)}>Match automatically</button>{/if}
          <form onsubmit={event => { event.preventDefault(); void searchMatches(); }}>
            <label for="match-query">Search title</label>
            <input id="match-query" bind:value={query} maxlength="250" disabled={busy} required />
            <label for="match-provider">Search provider</label>
            <select id="match-provider" bind:value={searchProvider} disabled={busy || searchableProviders.length === 0}>{#each searchableProviders as provider}<option value={provider}>{provider}</option>{/each}</select>
            <button disabled={busy || !query.trim()}>Search candidates</button>
          </form>
          {#if candidateGameId === selected.id}
            {#if candidates.length === 0}<p class="empty">No results from {searchProvider || 'the selected provider'}. Try another title or provider.</p>{:else}<ul aria-label="Match candidates">
              {#each candidates as candidate (`${candidate.providerId}:${candidate.recordId}`)}
                <li class="candidate"><div><strong>{candidate.title}</strong><dl><dt>Release year</dt><dd>{candidate.releaseYear ?? 'Unknown'}</dd><dt>Provider</dt><dd>{candidate.providerId}</dd><dt>Record ID</dt><dd>{candidate.recordId}</dd><dt>Artwork</dt><dd>{candidate.hasArtwork ? 'Available' : 'Not reported by this search'}</dd></dl></div>
                  <button class="select-match" disabled={busy} onclick={() => match(false, candidate)}>✓ Select</button></li>
              {/each}
            </ul>{/if}
          {/if}
        </section></div></div>{/if}
        {#if detailModal === 'manual'}<div class="modal-backdrop" role="button" tabindex="0" onclick={() => detailModal = null} onkeydown={event => { if (event.key === 'Escape' || event.key === 'Enter') detailModal = null; }}><div class="modal" role="dialog" tabindex="-1" aria-label="Manual edits" onclick={event => event.stopPropagation()} onkeydown={event => event.stopPropagation()}><button class="close" onclick={() => detailModal = null}>×</button><section class="matching" aria-label="Manual edits">
          <h3>Manual metadata and artwork</h3>
          <form onsubmit={event => { event.preventDefault(); void (async () => { const result = await window.gameShelf.saveOverrides(selected.id, { title: (event.currentTarget.elements.namedItem('manual-title') as HTMLInputElement).value, description: (event.currentTarget.elements.namedItem('manual-description') as HTMLTextAreaElement).value }); if (result.ok) catalog = result.value; notice = result.message || ''; })(); }}>
            <label for="manual-title">Title</label><input id="manual-title" name="manual-title" value={selected.metadata.title || ''} maxlength="10000" />
            <label for="manual-description">Description</label><textarea id="manual-description" name="manual-description" maxlength="10000">{selected.metadata.description || ''}</textarea>
            <button disabled={busy}>Save manual metadata</button>
          </form>
          <button disabled={busy} onclick={async () => { const result = await window.gameShelf.pasteArtwork(selected.id, 'cover'); if (result.ok) catalog = result.value; notice = result.message || ''; }}>Paste cover from clipboard</button>
          <button disabled={busy} onclick={async () => { const result = await window.gameShelf.pasteArtwork(selected.id, 'background'); if (result.ok) catalog = result.value; notice = result.message || ''; }}>Paste background from clipboard</button>
          <button disabled={busy} onclick={async () => { if (!confirm('Replace all manual metadata and artwork with the current provider data?')) return; const result = await window.gameShelf.replaceAllRescrape(selected.id); if (result.ok) catalog = result.value; notice = result.message || ''; }}>Replace all manual work</button>
        </section></div></div>{/if}
        {#if detailModal === 'artwork'}<div class="modal-backdrop" role="button" tabindex="0" onclick={() => detailModal = null} onkeydown={event => { if (event.key === 'Escape' || event.key === 'Enter') detailModal = null; }}><div class="modal" role="dialog" tabindex="-1" aria-label="Fetch artwork" onclick={event => event.stopPropagation()} onkeydown={event => event.stopPropagation()}><button class="close" onclick={() => detailModal = null}>×</button><section class="matching artwork-modal" aria-label="Fetch artwork">
          <h3>Fetch artwork</h3>{#if artworkPreview}<p class="muted">Confirm to replace the artwork below. “Manual” means an image pasted through Edit metadata & artwork.</p><div class="artwork-preview">{#each artworkPreview.items as item (item.kind)}<section><h4>{item.kind === 'cover' ? 'Cover' : 'Background'}</h4><div class="artwork-comparison"><div><strong>Current{item.currentSource === 'manual' ? ' · manual' : ''}</strong>{#if item.currentUrl}<img src={item.currentUrl} alt={`Current ${item.kind}`} />{:else}<span class="preview-placeholder">No current artwork</span>{/if}</div><div><strong>New</strong><img src={item.proposedUrl} alt={`New ${item.kind}`} /></div></div></section>{/each}</div><button class="primary" disabled={busy} onclick={confirmArtwork}>Replace artwork</button><button disabled={busy} onclick={() => { artworkPreview = null; artworkNotice = ''; }}>Cancel</button>{:else}<p class="muted">Downloads available cover and background art for review. It does not replace anything until you confirm.</p><label for="steamgrid-id">SteamGridDB game ID <small>Optional; title lookup is used when blank.</small></label><input id="steamgrid-id" bind:value={steamGridDbId} inputmode="numeric" pattern="[0-9]*" maxlength="19" placeholder="Optional SteamGridDB ID" /><button disabled={busy} onclick={fetchArtwork}>▧ Fetch artwork</button>{/if}{#if artworkNotice}<p class="artwork-notice" role="status">{artworkNotice}</p>{/if}
        </section></div></div>{/if}
    </section>{/if}
  </div>
  {/if}</section>
</main>

<style>
  :global(html), :global(body) { height: 100%; overflow: hidden; }
  :global(body) { margin: 0; background: #171b24; color: #edf0f6; font-family: system-ui, sans-serif; }
  :global(*) { box-sizing: border-box; }
  main { height: 100vh; }
  .app-shell { display: grid; grid-template-columns: 230px minmax(0, 1fr); height: 100vh; overflow: hidden; }
  .sidebar { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; padding: 22px 14px; background: #131821; border-right: 1px solid #394154; }
  .workspace { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; padding: 22px 28px; }
  header { display: block; margin-bottom: 22px; }
  .eyebrow { color: #aabaff; font-size: 11px; letter-spacing: .12em; margin: 0; }
  h1 { font-size: 32px; margin: 4px 0 0; }
  h2 { font-size: 18px; margin: 0 0 12px; overflow-wrap: anywhere; }
  h3 { font-size: 15px; margin: 0 0 10px; }
  p { color: #bcc5d5; line-height: 1.5; }
  .version, .muted, .path, [role='status'], .count { font-size: 13px; color: #bcc5d5; }
  .path { overflow-wrap: anywhere; }
  .setup, .game-list, .details, .status-card { padding: 20px; border: 1px solid #394154; border-radius: 10px; background: #202633; }
  .setup { margin-bottom: 20px; }
  .setup .path { margin: -4px 0 16px; }
  [role='status'] { margin-bottom: 0; min-height: 20px; }
  button { padding: 9px 12px; border: 1px solid #566380; border-radius: 6px; background: #293246; color: #edf0f6; font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
  button:hover { background: #35446a; }
  .primary { background: #435caa; border-color: #788bce; }
  .danger { background: #7f2e3a; border-color: #d67783; color: #fff; }
  .danger:hover { background: #983846; }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible { outline: 2px solid #aabaff; outline-offset: 3px; }
  .catalog { display: grid; flex: 1; min-height: 0; grid-template-columns: minmax(0, 1fr) minmax(360px, 44%); gap: 20px; align-items: stretch; overflow: hidden; }
  .catalog:not(.detail-open) { grid-template-columns: minmax(0, 1fr); }
  .catalog > nav { display: none; }
  .game-list, .details { min-height: 0; height: 100%; overflow-y: auto; }
  .settings-panel { height: 100%; overflow-y: auto; }
  .sidebar, .game-list, .details, .settings-panel, .modal { scrollbar-width: thin; scrollbar-color: #7186c9 #171d29; }
  .sidebar::-webkit-scrollbar, .game-list::-webkit-scrollbar, .details::-webkit-scrollbar, .settings-panel::-webkit-scrollbar, .modal::-webkit-scrollbar { width: 10px; height: 10px; }
  .sidebar::-webkit-scrollbar-track, .game-list::-webkit-scrollbar-track, .details::-webkit-scrollbar-track, .settings-panel::-webkit-scrollbar-track, .modal::-webkit-scrollbar-track { background: #171d29; border-radius: 999px; }
  .sidebar::-webkit-scrollbar-thumb, .game-list::-webkit-scrollbar-thumb, .details::-webkit-scrollbar-thumb, .settings-panel::-webkit-scrollbar-thumb, .modal::-webkit-scrollbar-thumb { border: 2px solid #171d29; border-radius: 999px; background: linear-gradient(#91a4eb, #586fae); }
  .sidebar::-webkit-scrollbar-thumb:hover, .game-list::-webkit-scrollbar-thumb:hover, .details::-webkit-scrollbar-thumb:hover, .settings-panel::-webkit-scrollbar-thumb:hover, .modal::-webkit-scrollbar-thumb:hover { background: linear-gradient(#b5c1ff, #7186c9); }
  .pages { display: grid; gap: 6px; margin-bottom: 18px; }
  .pages button { width: 100%; display: flex; align-items: center; gap: 10px; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .filters { align-items: end; padding: 12px; border: 1px solid #394154; border-radius: 10px; background: linear-gradient(135deg, #252d3e, #1c2230); }
  .filters label { display: grid; gap: 5px; color: #bcc5d5; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
  .filters input, .filters select { min-width: 115px; padding: 9px 10px; color: #edf0f6; background: #121722; border: 1px solid #566380; border-radius: 7px; outline: none; }
  .filters input:focus, .filters select:focus { border-color: #9cadff; box-shadow: 0 0 0 3px rgb(156 173 255 / .18); }
  .filters .search-filter { flex: 1 1 210px; display: flex; align-items: center; padding: 0 10px; color: #aabaff; background: #121722; border: 1px solid #566380; border-radius: 7px; }
  .search-icon { display: flex; width: 20px; height: 100%; align-items: center; justify-content: center; flex: none; }
  .search-icon svg { display: block; width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .filters .search-filter input { width: 100%; min-width: 0; border: 0; box-shadow: none; background: transparent; font-size: 13px; letter-spacing: normal; text-transform: none; }
  .status-card { display: flex; justify-content: flex-end; gap: 22px; margin: 0 0 18px auto; width: fit-content; }
  .sidebar-status { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); justify-content: initial; gap: 4px; margin: 0; padding: 10px 6px; }
  .matching-status { display: grid; gap: 5px; margin-top: 12px; padding: 10px; border: 1px solid #4c5b78; border-radius: 8px; background: #1a2230; }
  .matching-status strong { font-size: 13px; }.matching-status span, .matching-status small { color: #bcc5d5; font-size: 11px; overflow-wrap: anywhere; }
  .sidebar-notice { margin: 12px 2px 0; overflow-wrap: anywhere; }
  .sidebar-footer { display: grid; gap: 10px; margin-top: auto; padding-top: 24px; }
  .settings-link { display: flex; align-items: center; width: 100%; gap: 10px; }
  .settings-link span { color: #bcc5d5; }
  .author-link { color: #929db1; font-size: 10px; line-height: 1.4; text-align: center; text-decoration: none; }
  .author-link:hover { color: #c7d0e1; text-decoration: underline; }
  .author-link:focus-visible { outline: 2px solid #aabaff; outline-offset: 3px; }
  .status-card div, .status-card button { display: grid; gap: 2px; min-width: 0; padding: 6px 2px; text-align: center; overflow-wrap: anywhere; }
  .status-card strong { font-size: 20px; }.status-card span { color: #bcc5d5; font-size: 11px; }
  nav button { width: 100%; margin-bottom: 8px; overflow-wrap: anywhere; }
  nav button span { float: right; margin-left: 8px; color: #bcc5d5; }
  button.active { border-color: #aabaff; background: #33436b; }
  ul { list-style: none; padding: 0; margin: 0; }
  li + li { margin-top: 8px; }
  li button { width: 100%; overflow-wrap: anywhere; }
  .game-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 14px; }
  .list-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .list-heading h2 { margin: 0; }
  .back { flex: none; }
  .home-section { margin-top: 28px; }
  .home-section:first-of-type { margin-top: 0; }
  .home-group { margin-top: 24px; }
  .group-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .group-heading label { display: flex; align-items: center; gap: 7px; color: #bcc5d5; font-size: 12px; }
  .group-heading select { padding: 7px 9px; color: #edf0f6; background: #171b24; border: 1px solid #566380; border-radius: 6px; }
  .collection-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
  .game-grid li + li { margin-top: 0; }
  small { display: block; font-size: 12px; color: #bcc5d5; margin-top: 4px; }
  .missing { color: #f0c18c; }
  .count { margin-left: 6px; }
  .empty { margin: 20px 0; font-size: 14px; }
  dt { color: #a5b0c6; font-size: 12px; margin-top: 14px; }
  dd { margin: 4px 0 0; font-size: 13px; overflow-wrap: anywhere; }
  .details button { margin-top: 8px; }
  .location-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .location-actions button { margin: 0; }
  .install { background: #276a48; border-color: #62ae82; font-weight: 700; }
  .install:hover { background: #348158; }
  .details { position: relative; }
  .detail-controls { position: absolute; z-index: 4; top: 8px; right: 8px; display: flex; align-items: start; gap: 8px; }
  .detail-controls button { margin: 0; }
  .details-close { font-size: 18px; padding: 2px 9px; }
  .detail-hero { position: relative; margin-bottom: 12px; }
  .detail-hero.has-background { position: relative; min-height: 150px; display: flex; align-items: end; overflow: hidden; border-radius: 6px; }
  .detail-heading { position: relative; z-index: 1; display: flex; align-items: start; gap: 12px; width: 100%; padding-right: 42px; }
  .detail-hero.has-background .detail-heading { padding: 38px 14px 14px; background: linear-gradient(transparent, rgb(10 14 20 / .92)); }
  .detail-hero.has-background h2 { color: #fff; text-shadow: 0 2px 8px #000; }
  .detail-heading h2 { margin-right: auto; }
  .detail-aside { float: right; width: min(300px, 42%); margin: 0 0 12px 18px; }
  .cover { width: 100%; height: auto; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 6px; border: 1px solid #566380; }
  .collection-link { display: grid; width: 100%; gap: 3px; margin: 10px 0 0 !important; padding: 10px 12px; border-color: #677ab4; background: #273451; }
  .collection-link small { margin: 0; color: #b8c8ff; }
  .collection-link strong { overflow-wrap: anywhere; }
  .placeholder { min-height: 140px; display: grid; place-items: center; padding: 8px; color: #a5b0c6; font-size: 12px; text-align: center; background: #171b24; }
  .background { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .58; }
  .description { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .matching { border-top: 1px solid #394154; margin-top: 20px; padding-top: 8px; }
  .matching h3 { font-size: 15px; }
  .match-context { display: grid; gap: 4px; margin: 12px 0; padding: 12px; border: 1px solid #4c5b78; border-radius: 7px; background: #171d29; }
  .match-context span { color: #bcc5d5; font-size: 12px; overflow-wrap: anywhere; }
  .matching label { display: block; margin: 16px 0 6px; font-size: 13px; }
  .matching input, .matching select { width: 100%; padding: 8px; caret-color: #fff; background: #171b24; color: #edf0f6; border: 1px solid #566380; border-radius: 4px; }
  .matching textarea { width: 100%; min-height: 80px; padding: 8px; background: #171b24; color: #edf0f6; border: 1px solid #566380; border-radius: 4px; }
  .matching li { margin-top: 12px; border-top: 1px solid #394154; padding-top: 8px; }
  .candidate { display: flex; align-items: end; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid #394154; border-radius: 7px; background: #171d29; }
  .candidate > div { min-width: 0; flex: 1; }
  .candidate .select-match { width: auto; min-width: 0; flex: none; align-self: end; white-space: nowrap; }
  .candidate dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 8px; margin: 8px 0 0; }
  .candidate dt, .candidate dd { margin: 0; font-size: 12px; }
  .candidate dt { color: #a5b0c6; }
  .settings-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 20px; border-bottom: 1px solid #394154; padding-bottom: 10px; }
  .settings-tabs button { min-width: 100px; text-align: center; }
  .settings-form { display: grid; gap: 16px; max-width: 720px; }
  .settings-tab-panel { display: grid; gap: 16px; }
  .settings-tab-panel[hidden] { display: none; }
  .library-setup { padding: 16px; border: 1px solid #4c5b78; border-radius: 8px; background: #171d29; }
  .library-setup .path { margin: -4px 0 16px; }
  .settings-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .settings-actions button { margin: 0; }
  .catalog-maintenance { margin-top: 4px; }
  .save-settings { width: fit-content; }
  .settings-form label { display: grid; gap: 6px; }
  .settings-form input, .settings-form select { width: 100%; padding: 8px; color: #edf0f6; background: #171b24; border: 1px solid #566380; border-radius: 4px; }
  .settings-form fieldset { display: grid; gap: 10px; border: 1px solid #566380; border-radius: 6px; padding: 14px; }
  .settings-form fieldset label { display: block; }
  .settings-form fieldset label { display: flex; align-items: center; gap: 8px; }
  .settings-form input[type='checkbox'] { width: auto; margin: 0; }
  .settings-form .checkbox-label { display: flex; align-items: center; gap: 8px; }
  .settings-form .greedy-match { display: block; padding: 12px; border: 1px solid #566380; border-radius: 6px; background: #171d29; }
  .greedy-match small { margin-left: 28px; }
  .edit-menu { position: relative; }
  .edit-menu > button { display: inline-flex; align-items: center; gap: 8px; }
  .edit-menu > button span { font-size: 18px; line-height: .6; }
  .edit-menu-items { position: absolute; top: 100%; right: 0; display: grid; min-width: 190px; margin-top: 6px; padding: 6px; border: 1px solid #566380; border-radius: 7px; background: #202633; box-shadow: 0 10px 30px #0008; }
  .edit-menu-items button { width: 100%; margin: 0; }
  .artwork-modal label { display: grid; gap: 4px; margin: 16px 0 6px; font-size: 13px; }
  .artwork-modal small { color: #bcc5d5; font-size: 11px; }
  .artwork-modal input { width: 100%; padding: 8px; background: #171b24; color: #edf0f6; border: 1px solid #566380; border-radius: 4px; }
  .artwork-notice { padding: 10px; border: 1px solid #4c5b78; border-radius: 6px; background: #171d29; font-size: 13px; }
  .artwork-preview { display: grid; gap: 14px; margin: 16px 0; }
  .artwork-preview section { border: 1px solid #394154; border-radius: 7px; padding: 12px; }
  .artwork-preview h4 { margin: 0 0 8px; font-size: 13px; }
  .artwork-comparison { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .artwork-comparison > div { display: grid; gap: 6px; min-width: 0; }
  .artwork-comparison strong { font-size: 12px; color: #bcc5d5; }
  .artwork-comparison img, .preview-placeholder { width: 100%; height: 160px; object-fit: cover; border: 1px solid #566380; border-radius: 5px; background: #171b24; }
  .preview-placeholder { display: grid; place-items: center; padding: 8px; color: #a5b0c6; font-size: 12px; text-align: center; }
  .modal-backdrop { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: 20px; background: rgb(0 0 0 / .6); }
  .modal { position: relative; width: min(620px, 100%); max-height: 85vh; overflow: auto; padding: 24px; border: 1px solid #566380; border-radius: 10px; background: #202633; box-shadow: 0 20px 60px #000; }
  .modal .matching { margin-top: 0; }.close { float: right; font-size: 20px; padding: 2px 9px; }
  @media (max-width: 850px) {
    :global(html), :global(body) { height: auto; overflow: auto; } main, .app-shell { height: auto; overflow: visible; }.app-shell { grid-template-columns: 1fr; }.sidebar { overflow: visible; border-right: 0; border-bottom: 1px solid #394154; }.pages { grid-template-columns: repeat(3, 1fr); }.sidebar-footer { margin-top: 12px; }.workspace { display: block; overflow: visible; padding: 16px; }.catalog { display: grid; overflow: visible; grid-template-columns: 1fr; }.game-list, .details, .settings-panel { height: auto; overflow: visible; }.details { grid-column: auto; }
  }
</style>
