<script lang="ts">
  import { onMount } from 'svelte';
  import type { ArtworkPreview, CatalogView, LibraryState, MatchCandidate, SettingsView, MatchingStatus } from '../../shared/api';

  let version = $state('');
  let library = $state<LibraryState>();
  let catalog = $state<CatalogView>({ games: [], collections: [] });
  let busy = $state(false);
  let notice = $state('');
  let collectionId = $state<number | null>(null);
  let selectedId = $state<number | null>(null);
  let needsMatching = $state(false);
  let page = $state<'home' | 'games' | 'collections' | 'settings'>('games');
  let settings = $state<SettingsView>();
  let matchingStatus = $state<MatchingStatus>({ phase: 'idle', attempted: 0, total: 0, matched: 0 });
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
  let detailModal = $state<'matching' | 'manual' | 'artwork' | null>(null);
  let detailMenu = $state(false);
  const collection = $derived(catalog.collections.find(item => item.id === collectionId));
  const games = $derived(catalog.games.filter(game => (!needsMatching || game.matchStatus === 'unmatched') && (collectionId === null || game.collectionId === collectionId) && (collectionFilter === 'all' || collectionFilter === 'none' ? collectionFilter === 'all' || game.collectionId === null : game.collectionId === Number(collectionFilter)) && (!yearFilter || String(game.metadata.releaseYear ?? '') === yearFilter) && (!genreFilter || game.metadata.genres?.includes(genreFilter)) && (!titleFilter || (game.metadata.title || game.folderName).toLocaleLowerCase().includes(titleFilter.toLocaleLowerCase()))).sort((a, b) => sort === 'releaseDate' ? (b.metadata.releaseYear ?? -1) - (a.metadata.releaseYear ?? -1) || (a.metadata.title || a.folderName).localeCompare(b.metadata.title || b.folderName) : (a.metadata.title || a.folderName).localeCompare(b.metadata.title || b.folderName)));
  const years = $derived([...new Set(catalog.games.flatMap(game => game.metadata.releaseYear ? [game.metadata.releaseYear] : []))].sort((a, b) => b - a));
  const genres = $derived([...new Set(catalog.games.flatMap(game => game.metadata.genres ?? []))].sort((a, b) => a.localeCompare(b)));
  const selected = $derived(catalog.games.find(game => game.id === selectedId));
  const searchableProviders = $derived((settings?.providerOrder ?? []).filter(id => id !== 'steamgriddb' && settings?.providers[id]?.enabled && settings.providers[id]?.configured));
  const recentlyAdded = $derived.by(() => {
    const firstAddedAt = catalog.games.reduce((earliest, game) => !earliest || game.addedAt < earliest ? game.addedAt : earliest, '');
    return catalog.games.filter(game => firstAddedAt && game.addedAt > firstAddedAt)
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt) || (a.metadata.title || a.folderName).localeCompare(b.metadata.title || b.folderName));
  });
  const homeGroups = $derived.by(() => {
    const groups = new Map<string, CatalogView['games']>();
    for (const game of catalog.games) {
      const labels = homeGroupBy === 'decade'
        ? [game.metadata.releaseYear ? `${Math.floor(game.metadata.releaseYear / 10) * 10}s` : 'Unknown release date']
        : game.metadata.genres?.length ? game.metadata.genres : ['Uncategorized'];
      for (const label of labels) groups.set(label, [...(groups.get(label) ?? []), game]);
    }
    return [...groups.entries()].sort(([a], [b]) => homeGroupBy === 'decade'
      ? (a === 'Unknown release date' ? 1 : b === 'Unknown release date' ? -1 : b.localeCompare(a))
      : a.localeCompare(b)).map(([label, items]) => ({ label, games: items.sort((a, b) => (a.metadata.title || a.folderName).localeCompare(b.metadata.title || b.folderName)) }));
  });
  const collectionName = (id: number | null) => {
    const item = catalog.collections.find(item => item.id === id);
    return item ? item.displayName || item.folderName : 'None';
  };
  const date = (value: string) => new Date(value).toLocaleString();
  function selectGame(id: number) {
    selectedId = id;
    query = catalog.games.find(game => game.id === id)?.folderName ?? '';
    candidates = []; candidateGameId = null; detailMenu = false;
  }
  function openMatching() {
    if (!selected) return;
    query = selected.metadata.title || selected.folderName;
    searchProvider = searchableProviders[0] ?? '';
    candidates = []; candidateGameId = null;
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
      const result = automatic ? await window.gameShelf.autoMatch(id)
        : await window.gameShelf.selectMatch(id, candidate!.providerId, candidate!.recordId);
      if (result.ok) {
        catalog = result.value; candidates = []; candidateGameId = null;
        if (result.value.games.find(game => game.id === id)?.matchStatus === 'matched') detailModal = null;
      }
      notice = result.message ?? 'Match saved.';
    } catch { notice = 'Matching failed. Please retry.'; }
    finally { busy = false; }
  }

  async function searchMatches() {
    if (!selected) return;
    const id = selected.id;
    busy = true; candidates = []; candidateGameId = null; notice = 'Searching the selected metadata provider…';
    try {
      const result = await window.gameShelf.searchMatches(id, query, searchProvider || undefined);
      if (result.ok && selectedId === id) { candidates = result.value.candidates; candidateGameId = id; }
      notice = result.message ?? '';
    } catch { notice = 'Search failed. Please retry.'; }
    finally { busy = false; }
  }

  async function refresh(choose = false) {
    busy = true;
    notice = '';
    try {
      library = await (choose ? window.gameShelf.chooseLibraryRoot() : window.gameShelf.getLibraryState());
      const result = await window.gameShelf.getCatalog();
      if (result.ok) catalog = result.value;
      else notice = result.message;
    } catch { notice = 'Unable to load the library. Please retry.'; }
    finally { busy = false; }
  }

  async function scan() {
    busy = true;
    notice = 'Scanning library, then matching unresolved games…';
    candidates = []; candidateGameId = null;
    await refreshMatchingStatus();
    const progressTimer = setInterval(() => { void refreshMatchingStatus(); }, 300);
    try {
      const result = await window.gameShelf.scanLibrary();
      if (result.ok) catalog = result.value;
      notice = result.message ?? 'Scan complete.';
      library = await window.gameShelf.getLibraryState();
      const settingsResult = await window.gameShelf.getSettings();
      if (settingsResult.ok) settings = settingsResult.value;
    } catch { notice = 'Unable to complete the scan. Please retry.'; }
    finally { clearInterval(progressTimer); await refreshMatchingStatus(); busy = false; }
  }

  async function refreshMatchingStatus() {
    try { matchingStatus = await window.gameShelf.getMatchingStatus(); } catch { /* Status is nonessential UI feedback. */ }
  }

  async function fetchArtwork() {
    if (!selected) return;
    busy = true;
    try { const result = await window.gameShelf.fetchArtwork(selected.id, steamGridDbId.trim() || undefined); if (result.ok) artworkPreview = result.value; artworkNotice = result.message ?? ''; notice = artworkNotice; }
    catch { artworkNotice = 'Could not fetch artwork. Please retry.'; notice = artworkNotice; }
    finally { busy = false; }
  }
  async function confirmArtwork() {
    if (!selected) return;
    busy = true;
    try { const result = await window.gameShelf.confirmArtwork(selected.id); if (result.ok) { catalog = result.value; artworkPreview = null; } artworkNotice = result.message ?? ''; notice = artworkNotice; }
    catch { artworkNotice = 'Could not replace artwork. Please retry.'; notice = artworkNotice; }
    finally { busy = false; }
  }

  async function openFolder() {
    if (!selected) return;
    busy = true;
    try {
      const result = await window.gameShelf.openInstallFolder(selected.id);
      notice = result.message ?? 'Install location opened.';
    } catch { notice = 'Unable to open the install location. Please retry.'; }
    finally { busy = false; }
  }

  onMount(() => {
    window.gameShelf.getAppInfo().then(info => { version = info.version; }).catch(() => { notice = 'Unable to read app information.'; });
    void refresh();
    void refreshMatchingStatus();
    window.gameShelf.getSettings().then(result => { if (result.ok) settings = result.value; });
    const keys = (event: KeyboardEvent) => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !games.length) return; event.preventDefault(); const current = Math.max(0, games.findIndex(game => game.id === selectedId)); const columns = Math.max(1, Math.floor((window.innerWidth - 300) / 152)); const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns; selectGame(games[Math.max(0, Math.min(games.length - 1, current + offset))].id); };
    window.addEventListener('keydown', keys); return () => window.removeEventListener('keydown', keys);
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
    <button class:active={page === 'collections'} aria-pressed={page === 'collections'} onclick={() => { page = 'collections'; needsMatching = false; collectionId = null; }}>▤ <span>Collections</span></button>
    <button class:active={page === 'settings'} aria-pressed={page === 'settings'} onclick={() => page = 'settings'}>⚙ <span>Settings</span></button>
  </nav>

  <section class="setup" aria-label="Library setup">
    <h2>{library?.status === 'ready' ? 'Library ready' : library?.status === 'unavailable' ? 'Library unavailable' : 'Choose your library'}</h2>
    {#if library?.root}<p class="path">{library.root}</p>{/if}
    <div class="actions">
      <button class="primary" disabled={busy || library?.status !== 'ready'} onclick={scan}>Scan library</button>
      <button disabled={busy || !library || library.status === 'config-error'} onclick={() => refresh(true)}>Choose library folder</button>
      <button disabled={busy} onclick={() => refresh()}>Retry</button>
    </div>
    <p role="status" aria-live="polite">{notice || library?.message || 'Loading…'}</p>
  </section><section class="status-card sidebar-status" aria-label="Library status"><div><strong>{catalog.games.length}</strong><span>Games</span></div><div><strong>{catalog.collections.length}</strong><span>Collections</span></div><button onclick={() => { page = 'games'; needsMatching = true; collectionId = null; }}><strong>{catalog.games.filter(game => game.matchStatus === 'unmatched').length}</strong><span>Needs matching</span></button></section><section class="matching-status" aria-label="Matching status"><strong>{matchingStatus.phase === 'matching' ? `Matching ${matchingStatus.attempted}/${matchingStatus.total}` : matchingStatus.phase === 'scanning' ? 'Scanning library' : matchingStatus.phase === 'complete' ? 'Matching complete' : 'Matching ready'}</strong><span>{matchingStatus.message || 'Run Scan library to match unresolved games.'}</span>{#if matchingStatus.gameName && matchingStatus.phase === 'matching'}<small>{matchingStatus.gameName} · {matchingStatus.matched} matched</small>{/if}</section></aside>

  <section class="workspace">

  {#if page === 'settings' && settings}
    <section class="setup settings-panel" aria-label="Settings"><h2>Settings</h2><p class="muted">Credentials are never shown after saving.</p>
      <form class="settings-form" onsubmit={event => { event.preventDefault(); void (async () => { const form = event.currentTarget; const get = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value; const result = await window.gameShelf.saveSettings({ collectionPrefix: get('prefix'), showCollectionGames: (form.elements.namedItem('visible') as HTMLInputElement).checked, matchingThreshold: Number(get('threshold')), defaultSort: get('sort') as 'title' | 'releaseDate', providerOrder: get('order').split(',').map(id => id.trim()).filter(Boolean), providers: { igdb: { enabled: (form.elements.namedItem('igdb') as HTMLInputElement).checked, configured: settings!.providers.igdb.configured }, thegamesdb: { enabled: (form.elements.namedItem('thegamesdb') as HTMLInputElement).checked, configured: settings!.providers.thegamesdb.configured }, steamgriddb: { enabled: (form.elements.namedItem('steamgriddb') as HTMLInputElement).checked, configured: settings!.providers.steamgriddb.configured } }, credentials: { igdbClientId: get('igdb-client'), igdbClientSecret: get('igdb-secret'), thegamesdbApiKey: get('thegamesdb-key'), steamgriddbApiKey: get('steamgriddb-key') } }); if (result.ok) settings = result.value; notice = result.ok ? 'Settings saved.' : result.message; })(); }}>
        <label>Collection prefix <input name="prefix" value={settings.collectionPrefix} /></label><label><input name="visible" type="checkbox" checked={settings.showCollectionGames} /> Show collection games in main library</label><label>Matching threshold <input name="threshold" type="number" min="0" max="1" step="0.01" value={settings.matchingThreshold} /></label><label>Default sort <select name="sort" value={settings.defaultSort}><option value="title">Title</option><option value="releaseDate">Release date</option></select></label><label>Provider order <input name="order" value={settings.providerOrder.join(',')} /></label>
        <fieldset><legend>Providers</legend><label><input name="igdb" type="checkbox" checked={settings.providers.igdb.enabled} /> IGDB {settings.providers.igdb.configured ? 'configured' : 'not configured'}</label><input name="igdb-client" placeholder="New IGDB client ID" /><input name="igdb-secret" type="password" placeholder="New IGDB client secret" /><label><input name="thegamesdb" type="checkbox" checked={settings.providers.thegamesdb.enabled} /> TheGamesDB {settings.providers.thegamesdb.configured ? 'configured' : 'not configured'}</label><input name="thegamesdb-key" type="password" placeholder="New TheGamesDB API key" /><label><input name="steamgriddb" type="checkbox" checked={settings.providers.steamgriddb.enabled} /> SteamGridDB {settings.providers.steamgriddb.configured ? 'configured' : 'not configured'}</label><input name="steamgriddb-key" type="password" placeholder="New SteamGridDB API key" /><p class="muted">SteamGridDB supplies cover and banner art only. After a game is matched, use Fetch artwork on its details page to request missing assets.</p></fieldset><button class="primary">Save settings</button></form>
      <section class="matching"><h3>Catalog maintenance</h3><p class="muted">These actions affect catalog records only. They never alter installer folders.</p><button onclick={async () => { if (!confirm('Remove all records currently marked missing? This cannot be undone.')) return; const result = await window.gameShelf.deleteMissing(); if (result.ok) catalog = result.value; notice = result.message || ''; }}>Remove missing records</button><button onclick={async () => { if (!confirm('Rebuild the catalog from the current library? This removes saved matches, manual metadata, and artwork associations.')) return; const result = await window.gameShelf.rebuildCatalog(); if (result.ok) catalog = result.value; notice = result.message || ''; }}>Rebuild catalog</button></section>
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
          onclick={() => { page = 'collections'; needsMatching = false; collectionId = item.id; selectedId = null; }}>
          {item.displayName || item.folderName}
          <span>{catalog.games.filter(game => game.collectionId === item.id).length}</span>
          {#if item.missing}<small class="missing">Missing</small>{/if}
        </button>
      {/each}
      {#if catalog.collections.length === 0}<p class="muted">No collections yet.</p>{/if}
    </nav>

    <section class="game-list" aria-label="Games">
      {#if page === 'home'}<div class="home"><h2>Home</h2><section class="home-section"><h3>Collections</h3>{#if catalog.collections.length === 0}<p class="empty">No collections yet.</p>{:else}<div class="collection-grid">{#each catalog.collections as item (item.id)}{@const artwork = catalog.games.find(game => game.collectionId === item.id && game.coverUrl)?.coverUrl}<button class="collection-card" onclick={() => { page = 'collections'; collectionId = item.id; selectedId = null; }}>{#if artwork}<img src={artwork} alt="" />{:else}<span class="card-placeholder">Collection</span>{/if}<span>{item.displayName || item.folderName}</span></button>{/each}</div>{/if}</section>{#if recentlyAdded.length}<section class="home-section"><h3>Recently added</h3><div class="game-grid home-grid">{#each recentlyAdded as game (game.id)}<button class="game-card" onclick={() => selectGame(game.id)}>{#if game.coverUrl}<img src={game.coverUrl} alt={`Cover for ${game.metadata.title || game.folderName}`} />{:else}<span class="card-placeholder">No cover</span>{/if}{#if game.matchStatus === 'unmatched'}<span class="match-warning" title="Needs matching" aria-label="Needs matching">!</span>{/if}<span class="card-copy"><strong>{game.metadata.title || game.folderName}</strong><small>{date(game.addedAt)}</small></span></button>{/each}</div></section>{/if}<section class="home-section"><div class="group-heading"><h3>Library</h3><label>Group by <select bind:value={homeGroupBy}><option value="decade">Release decade</option><option value="genre">Genre</option></select></label></div>{#if homeGroups.length === 0}<p class="empty">No games yet. Choose your folder, then select Scan library.</p>{:else}{#each homeGroups as group (group.label)}<section class="home-group"><h3>{group.label} <span class="count">{group.games.length}</span></h3><div class="game-grid home-grid">{#each group.games as game (game.id)}<button class="game-card" onclick={() => selectGame(game.id)}>{#if game.coverUrl}<img src={game.coverUrl} alt={`Cover for ${game.metadata.title || game.folderName}`} />{:else}<span class="card-placeholder">No cover</span>{/if}{#if game.matchStatus === 'unmatched'}<span class="match-warning" title="Needs matching" aria-label="Needs matching">!</span>{/if}<span class="card-copy"><strong>{game.metadata.title || game.folderName}</strong>{#if homeGroupBy === 'genre' && game.metadata.releaseYear}<small>{game.metadata.releaseYear}</small>{/if}</span></button>{/each}</div></section>{/each}{/if}</section></div>{/if}
      {#if page === 'collections' && collectionId === null}<div class="home"><h2>Collections</h2>{#if catalog.collections.length === 0}<p class="empty">No collections yet.</p>{:else}<div class="collection-grid">{#each catalog.collections as item (item.id)}{@const artwork = catalog.games.find(game => game.collectionId === item.id && game.coverUrl)?.coverUrl}<button class="collection-card" onclick={() => { collectionId = item.id; selectedId = null; }}>{#if artwork}<img src={artwork} alt="" />{:else}<span class="card-placeholder">Collection</span>{/if}<span>{item.displayName || item.folderName}</span>{#if item.missing}<small class="missing">Missing</small>{/if}</button>{/each}</div>{/if}</div>{/if}
      {#if page === 'games' || (page === 'collections' && collectionId !== null)}
      <div class="filters" aria-label="Game filters"><label class="search-filter"><span class="search-icon" aria-hidden="true">⌕</span><input bind:value={titleFilter} placeholder="Search your library" /></label><label>Year <select bind:value={yearFilter}><option value="">All years</option>{#each years as year}<option value={String(year)}>{year}</option>{/each}</select></label><label>Genre <select bind:value={genreFilter}><option value="">All genres</option>{#each genres as genre}<option value={genre}>{genre}</option>{/each}</select></label><label>Collection <select bind:value={collectionFilter}><option value="all">All collections</option><option value="none">No collection</option>{#each catalog.collections as item}<option value={String(item.id)}>{item.displayName || item.folderName}</option>{/each}</select></label><label>Sort <select bind:value={sort}><option value="title">Title</option><option value="releaseDate">Release date</option></select></label></div>
      <h2>{needsMatching ? 'Needs Matching' : collection ? collection.displayName || collection.folderName : 'All games'} <span class="count">{games.length}</span></h2>
      {#if games.length === 0}
        <p class="empty">{needsMatching ? 'No games need matching.' : collection ? 'This collection has no cataloged games.' : 'No games yet. Choose your folder, then select Scan library.'}</p>
      {:else}
        <ul class="game-grid">
          {#each games as game (game.id)}
            <li><button class="game-card" class:active={selectedId === game.id} aria-pressed={selectedId === game.id} onclick={() => selectGame(game.id)}>
              {#if game.coverUrl}<img src={game.coverUrl} alt={`Cover for ${game.metadata.title || game.folderName}`} />{:else}<span class="card-placeholder" aria-hidden="true">No cover</span>{/if}
              {#if game.matchStatus === 'unmatched'}<span class="match-warning" title="Needs matching" aria-label="Needs matching">!</span>{/if}
              <span class="card-copy"><strong>{game.metadata.title || game.folderName}</strong>
                {#if game.metadata.releaseYear}<small>{game.metadata.releaseYear}</small>{/if}
                {#if game.collectionId !== null}<small>{collectionName(game.collectionId)}</small>{/if}
                {#if game.missing}<small class="missing">Missing</small>{/if}
              </span>
            </button></li>
          {/each}
        </ul>
      {/if}
      {/if}
    </section>

    {#if selected}<section class="details" aria-label="Game details">
        <div class="detail-hero" class:has-background={Boolean(selected.backgroundUrl)}>
          {#if selected.backgroundUrl}<img class="background" src={selected.backgroundUrl} alt="" />{/if}
          <div class="detail-heading"><h2>{selected.metadata.title || selected.folderName}</h2><button class="close details-close" aria-label="Close game details" onclick={() => { selectedId = null; detailModal = null; detailMenu = false; }}>×</button></div>
        </div>
        {#if selected.coverUrl}<img class="cover" src={selected.coverUrl} alt={`Cover for ${selected.metadata.title || selected.folderName}`} />{:else}<div class="cover placeholder" aria-label="No cover artwork available">No cover artwork</div>{/if}
        {#if selected.metadata.description}<p class="description">{selected.metadata.description}</p>{/if}
        <button class="install" disabled={busy} onclick={openFolder}>▣ Install</button>
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
        <div class="detail-actions"><div class="edit-menu"><button aria-haspopup="menu" aria-expanded={detailMenu} onclick={() => detailMenu = !detailMenu}>Edit <span aria-hidden="true">⋮</span></button>{#if detailMenu}<div class="edit-menu-items" role="menu"><button role="menuitem" onclick={openMatching}>{selected.matchStatus === 'matched' ? 'Change match' : 'Find metadata'}</button><button role="menuitem" onclick={() => { detailMenu = false; detailModal = 'manual'; }}>Edit metadata & artwork</button>{#if selected.matchStatus === 'matched'}<button role="menuitem" onclick={openArtwork}>Fetch artwork</button>{/if}</div>{/if}</div></div>
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
            <ul aria-label="Match candidates">
              {#each candidates as candidate (`${candidate.providerId}:${candidate.recordId}`)}
                <li class="candidate"><div><strong>{candidate.title}</strong><dl><dt>Release year</dt><dd>{candidate.releaseYear ?? 'Unknown'}</dd><dt>Provider</dt><dd>{candidate.providerId}</dd><dt>Record ID</dt><dd>{candidate.recordId}</dd><dt>Artwork</dt><dd>{candidate.hasArtwork ? 'Available' : 'Not reported by this search'}</dd></dl></div>
                  <button class="select-match" disabled={busy} onclick={() => match(false, candidate)}>✓ Select</button></li>
              {/each}
            </ul>
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
  :global(body) { margin: 0; background: #171b24; color: #edf0f6; font-family: system-ui, sans-serif; }
  :global(*) { box-sizing: border-box; }
  main { min-height: 100vh; }
  .app-shell { display: grid; grid-template-columns: 230px minmax(0, 1fr); }
  .sidebar { padding: 22px 14px; background: #131821; border-right: 1px solid #394154; }
  .workspace { min-width: 0; padding: 22px 28px; }
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
  .actions { display: grid; gap: 8px; }
  button { padding: 9px 12px; border: 1px solid #566380; border-radius: 6px; background: #293246; color: #edf0f6; font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
  button:hover { background: #35446a; }
  .primary { background: #435caa; border-color: #788bce; }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible { outline: 2px solid #aabaff; outline-offset: 3px; }
  .catalog { display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 44%); gap: 20px; align-items: start; }
  .catalog:not(.detail-open) { grid-template-columns: minmax(0, 1fr); }
  .catalog > nav { display: none; }
  .pages { display: grid; gap: 6px; margin-bottom: 18px; }
  .pages button { width: 100%; display: flex; align-items: center; gap: 10px; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .filters { align-items: end; padding: 12px; border: 1px solid #394154; border-radius: 10px; background: linear-gradient(135deg, #252d3e, #1c2230); }
  .filters label { display: grid; gap: 5px; color: #bcc5d5; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
  .filters input, .filters select { min-width: 115px; padding: 9px 10px; color: #edf0f6; background: #121722; border: 1px solid #566380; border-radius: 7px; outline: none; }
  .filters input:focus, .filters select:focus { border-color: #9cadff; box-shadow: 0 0 0 3px rgb(156 173 255 / .18); }
  .filters .search-filter { flex: 1 1 210px; display: flex; align-items: center; padding: 0 10px; color: #aabaff; background: #121722; border: 1px solid #566380; border-radius: 7px; }
  .search-icon { display: grid; width: 20px; height: 100%; place-items: center; flex: none; font-size: 18px; line-height: 1; }
  .filters .search-filter input { width: 100%; min-width: 0; border: 0; box-shadow: none; background: transparent; font-size: 13px; letter-spacing: normal; text-transform: none; }
  .status-card { display: flex; justify-content: flex-end; gap: 22px; margin: 0 0 18px auto; width: fit-content; }
  .sidebar-status { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); justify-content: initial; gap: 4px; margin: 0; padding: 10px 6px; }
  .matching-status { display: grid; gap: 5px; margin-top: 12px; padding: 10px; border: 1px solid #4c5b78; border-radius: 8px; background: #1a2230; }
  .matching-status strong { font-size: 13px; }.matching-status span, .matching-status small { color: #bcc5d5; font-size: 11px; overflow-wrap: anywhere; }
  .status-card div, .status-card button { display: grid; gap: 2px; min-width: 0; padding: 6px 2px; text-align: center; overflow-wrap: anywhere; }
  .status-card strong { font-size: 20px; }.status-card span { color: #bcc5d5; font-size: 11px; }
  nav button { width: 100%; margin-bottom: 8px; overflow-wrap: anywhere; }
  nav button span { float: right; margin-left: 8px; color: #bcc5d5; }
  button.active { border-color: #aabaff; background: #33436b; }
  ul { list-style: none; padding: 0; margin: 0; }
  li + li { margin-top: 8px; }
  li button { width: 100%; overflow-wrap: anywhere; }
  .game-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
  .home-section { margin-top: 28px; }
  .home-section:first-of-type { margin-top: 0; }
  .home-group { margin-top: 24px; }
  .group-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .group-heading label { display: flex; align-items: center; gap: 7px; color: #bcc5d5; font-size: 12px; }
  .group-heading select { padding: 7px 9px; color: #edf0f6; background: #171b24; border: 1px solid #566380; border-radius: 6px; }
  .collection-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
  .collection-card { position: relative; min-height: 180px; overflow: hidden; padding: 0; display: grid; place-items: end start; text-align: left; }
  .collection-card img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .42; filter: saturate(.7) brightness(.65); }
  .collection-card > span:not(.card-placeholder), .collection-card small { position: relative; z-index: 1; width: 100%; padding: 12px; background: linear-gradient(transparent, rgb(10 14 20 / .9)); font-size: 17px; font-weight: 700; }
  .collection-card small { padding-top: 0; font-size: 12px; }
  .game-grid li + li { margin-top: 0; }
  .game-card { position: relative; height: 100%; min-height: 250px; display: flex; flex-direction: column; padding: 0; overflow: hidden; text-align: left; }
  .game-card img, .card-placeholder { width: 100%; height: 175px; object-fit: cover; background: #171b24; }
  .card-placeholder { display: grid; place-items: center; color: #a5b0c6; font-size: 12px; }
  .card-copy { display: block; padding: 10px; }
  .card-copy strong { display: block; }
  .match-warning { position: absolute; z-index: 1; top: 8px; right: 8px; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: #f0c84b; color: #342900; font-size: 17px; font-weight: 900; box-shadow: 0 2px 8px #0009; }
  small { display: block; font-size: 12px; color: #bcc5d5; margin-top: 4px; }
  .missing { color: #f0c18c; }
  .count { margin-left: 6px; }
  .empty { margin: 20px 0; font-size: 14px; }
  dt { color: #a5b0c6; font-size: 12px; margin-top: 14px; }
  dd { margin: 4px 0 0; font-size: 13px; overflow-wrap: anywhere; }
  .details button { margin-top: 8px; }
  .install { background: #276a48; border-color: #62ae82; font-weight: 700; }
  .install:hover { background: #348158; }
  .details-close { float: right; margin: 0 !important; font-size: 18px; padding: 2px 9px; }
  .detail-hero { margin-bottom: 12px; }
  .detail-hero.has-background { position: relative; min-height: 150px; display: flex; align-items: end; overflow: hidden; border-radius: 6px; }
  .detail-heading { position: relative; z-index: 1; display: flex; align-items: start; justify-content: space-between; gap: 12px; width: 100%; }
  .detail-hero.has-background .detail-heading { padding: 38px 14px 14px; background: linear-gradient(transparent, rgb(10 14 20 / .92)); }
  .detail-hero.has-background h2 { color: #fff; text-shadow: 0 2px 8px #000; }
  .detail-heading h2 { margin-right: auto; }
  .cover { width: 300px; height: 450px; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 6px; float: right; margin: 0 0 12px 18px; border: 1px solid #566380; }
  .placeholder { min-height: 140px; display: grid; place-items: center; padding: 8px; color: #a5b0c6; font-size: 12px; text-align: center; background: #171b24; }
  .background { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .58; }
  .description { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .matching { border-top: 1px solid #394154; margin-top: 20px; padding-top: 8px; }
  .matching h3 { font-size: 15px; }
  .match-context { display: grid; gap: 4px; margin: 12px 0; padding: 12px; border: 1px solid #4c5b78; border-radius: 7px; background: #171d29; }
  .match-context span { color: #bcc5d5; font-size: 12px; overflow-wrap: anywhere; }
  .matching label { display: block; margin: 16px 0 6px; font-size: 13px; }
  .matching input, .matching select { width: 100%; padding: 8px; background: #171b24; color: #edf0f6; border: 1px solid #566380; border-radius: 4px; }
  .matching textarea { width: 100%; min-height: 80px; padding: 8px; background: #171b24; color: #edf0f6; border: 1px solid #566380; border-radius: 4px; }
  .matching li { margin-top: 12px; border-top: 1px solid #394154; padding-top: 8px; }
  .candidate { display: flex; align-items: end; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid #394154; border-radius: 7px; background: #171d29; }
  .candidate > div { min-width: 0; flex: 1; }
  .candidate .select-match { width: auto; min-width: 0; flex: none; align-self: end; white-space: nowrap; }
  .candidate dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 8px; margin: 8px 0 0; }
  .candidate dt, .candidate dd { margin: 0; font-size: 12px; }
  .candidate dt { color: #a5b0c6; }
  .settings-form { display: grid; gap: 16px; max-width: 620px; }
  .settings-form label { display: grid; gap: 6px; }
  .settings-form input, .settings-form select { width: 100%; padding: 8px; color: #edf0f6; background: #171b24; border: 1px solid #566380; border-radius: 4px; }
  .settings-form fieldset { display: grid; gap: 10px; border: 1px solid #566380; border-radius: 6px; padding: 14px; }
  .settings-form fieldset label { display: block; }
  .settings-form fieldset label { display: flex; align-items: center; gap: 8px; }
  .settings-form input[type='checkbox'] { width: auto; margin: 0; }
  .detail-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
  .edit-menu { position: relative; }
  .edit-menu > button { display: inline-flex; align-items: center; gap: 8px; }
  .edit-menu > button span { font-size: 18px; line-height: .6; }
  .edit-menu-items { position: absolute; z-index: 2; right: 0; top: calc(100% + 6px); display: grid; min-width: 190px; padding: 6px; border: 1px solid #566380; border-radius: 7px; background: #202633; box-shadow: 0 10px 30px #0008; }
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
    .app-shell { grid-template-columns: 1fr; }.sidebar { border-right: 0; border-bottom: 1px solid #394154; }.pages { grid-template-columns: repeat(4, 1fr); }.workspace { padding: 16px; }.catalog { grid-template-columns: 1fr; }.details { grid-column: auto; }
  }
</style>
