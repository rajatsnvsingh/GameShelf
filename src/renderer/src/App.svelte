<script lang="ts">
  import { onMount } from 'svelte';
  import CollectionCard from './components/CollectionCard.svelte';
  import GameDetails from './components/GameDetails.svelte';
  import GameCard from './components/GameCard.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import type {
    CatalogGame,
    CatalogView,
    LibraryState,
    MatchingStatus,
    SettingsView
  } from '../../shared/api';

  type Page = 'home' | 'games' | 'collections' | 'settings';
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
  let collectionId = $state<number | null>(null);
  let selectedId = $state<number | null>(null);
  let needsMatching = $state(false);
  let titleFilter = $state('');
  let yearFilter = $state('');
  let collectionFilter = $state('all');
  let genreFilter = $state('');
  let sort = $state<'title' | 'releaseDate'>('title');
  let homeGroupBy = $state<'decade' | 'genre'>('decade');

  let collectionBack = $state<CollectionBack | null>(null);

  const gameTitle = (game: CatalogGame) => game.metadata.title || game.displayName;
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

  async function fetchMissingMetadata() {
    busy = true;
    notice = 'Fetching missing metadata for matched games…';
    try {
      const result = await window.gameShelf.fetchMissingMetadata();
      if (result.ok) catalog = result.value;
      notice = result.message ?? '';
    } catch {
      notice = 'Could not fetch missing metadata. Please retry.';
    } finally {
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
      if (document.querySelector('dialog[open]')) return;
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
    <SettingsPanel {settings} {library} {catalog} {busy} onScan={scan} onFetchMissingMetadata={fetchMissingMetadata} onRefresh={refresh} onSave={saveSettings} onCatalog={value => catalog = value} onLibrary={value => library = value} onNotice={value => notice = value} />
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

    {#if selected}<GameDetails game={selected} collection={selectedCollection} {settings} onCatalog={value => catalog = value} onNotice={value => notice = value} onClose={() => selectedId = null} onOpenCollection={openCollection} />{/if}
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
  .version, .muted, [role='status'], .count { font-size: 13px; color: #bcc5d5; }
  .game-list, .status-card { padding: 20px; border: 1px solid #394154; border-radius: 10px; background: #202633; }
  [role='status'] { margin-bottom: 0; min-height: 20px; }
  button { padding: 9px 12px; border: 1px solid #566380; border-radius: 6px; background: #293246; color: #edf0f6; font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
  button:hover { background: #35446a; }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible { outline: 2px solid #aabaff; outline-offset: 3px; }
  .catalog { display: grid; flex: 1; min-height: 0; grid-template-columns: minmax(0, 1fr) minmax(360px, 44%); gap: 20px; align-items: stretch; overflow: hidden; }
  .catalog:not(.detail-open) { grid-template-columns: minmax(0, 1fr); }
  .catalog > nav { display: none; }
  .game-list { min-height: 0; height: 100%; overflow-y: auto; }
  :global(.details), :global(.settings-panel) { min-height: 0; height: 100%; overflow-y: auto; }
  .sidebar, .game-list { scrollbar-width: thin; scrollbar-color: #7186c9 #171d29; }
  .sidebar::-webkit-scrollbar, .game-list::-webkit-scrollbar { width: 10px; height: 10px; }
  .sidebar::-webkit-scrollbar-track, .game-list::-webkit-scrollbar-track { background: #171d29; border-radius: 999px; }
  .sidebar::-webkit-scrollbar-thumb, .game-list::-webkit-scrollbar-thumb { border: 2px solid #171d29; border-radius: 999px; background: linear-gradient(#91a4eb, #586fae); }
  .sidebar::-webkit-scrollbar-thumb:hover, .game-list::-webkit-scrollbar-thumb:hover { background: linear-gradient(#b5c1ff, #7186c9); }
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
  @media (max-width: 850px) {
    :global(html), :global(body) { height: auto; overflow: auto; } main, .app-shell { height: auto; overflow: visible; }.app-shell { grid-template-columns: 1fr; }.sidebar { overflow: visible; border-right: 0; border-bottom: 1px solid #394154; }.pages { grid-template-columns: repeat(3, 1fr); }.sidebar-footer { margin-top: 12px; }.workspace { display: block; overflow: visible; padding: 16px; }.catalog { display: grid; overflow: visible; grid-template-columns: 1fr; }.game-list, :global(.details), :global(.settings-panel) { height: auto; overflow: visible; }
  }
</style>
