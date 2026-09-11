<!-- Owns renderer navigation, transient catalog state, and composition of the main views. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import './styles/app.css';
  import CollectionCard from './components/CollectionCard.svelte';
  import GameDetails from './components/GameDetails.svelte';
  import GameCard from './components/GameCard.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import type {
    CatalogGame,
    CatalogView,
    LibraryState,
    MatchingStatus,
    SettingsView,
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
    matched: 0,
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

  const gameTitle = (game: CatalogGame) =>
    game.metadata.title || game.displayName;
  const isMatchingGame = (game: CatalogGame) =>
    !needsMatching || game.matchStatus === 'unmatched';
  const matchesCollectionFilter = (game: CatalogGame) => {
    if (collectionId !== null && game.collectionId !== collectionId)
      return false;
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
  const sortByTitle = (left: CatalogGame, right: CatalogGame) =>
    gameTitle(left).localeCompare(gameTitle(right));
  const sortGames = (items: CatalogGame[]) =>
    items.sort((left, right) => {
      if (sort === 'title') return sortByTitle(left, right);

      return (
        (right.metadata.releaseYear ?? -1) -
          (left.metadata.releaseYear ?? -1) || sortByTitle(left, right)
      );
    });

  const collection = $derived(
    catalog.collections.find((item) => item.id === collectionId)
  );
  const games = $derived(
    sortGames(
      catalog.games.filter(
        (game) =>
          isMatchingGame(game) &&
          matchesCollectionFilter(game) &&
          matchesMetadataFilters(game)
      )
    )
  );
  const years = $derived(
    [
      ...new Set(
        catalog.games.flatMap((game) =>
          game.metadata.releaseYear ? [game.metadata.releaseYear] : []
        )
      ),
    ].sort((left, right) => right - left)
  );
  const genres = $derived(
    [
      ...new Set(catalog.games.flatMap((game) => game.metadata.genres ?? [])),
    ].sort((left, right) => left.localeCompare(right))
  );
  const selected = $derived(
    catalog.games.find((game) => game.id === selectedId)
  );
  const selectedCollection = $derived(
    selected?.collectionId === null || selected?.collectionId === undefined
      ? undefined
      : catalog.collections.find((item) => item.id === selected.collectionId)
  );
  const recentlyAdded = $derived.by(() => {
    const firstAddedAt = catalog.games.reduce(
      (earliest, game) =>
        !earliest || game.addedAt < earliest ? game.addedAt : earliest,
      ''
    );

    return catalog.games
      .filter((game) => firstAddedAt && game.addedAt > firstAddedAt)
      .sort(
        (left, right) =>
          right.addedAt.localeCompare(left.addedAt) || sortByTitle(left, right)
      );
  });
  const homeGroups = $derived.by(() => {
    const groups = new Map<string, CatalogView['games']>();

    for (const game of catalog.games) {
      const labels =
        homeGroupBy === 'decade'
          ? [
              game.metadata.releaseYear
                ? `${Math.floor(game.metadata.releaseYear / 10) * 10}s`
                : 'Unknown release date',
            ]
          : game.metadata.genres?.length
            ? game.metadata.genres
            : ['Uncategorized'];

      for (const label of labels)
        groups.set(label, [...(groups.get(label) ?? []), game]);
    }

    return [...groups.entries()]
      .sort(([left], [right]) =>
        homeGroupBy === 'decade'
          ? left === 'Unknown release date'
            ? 1
            : right === 'Unknown release date'
              ? -1
              : right.localeCompare(left)
          : left.localeCompare(right)
      )
      .map(([label, items]) => ({ label, games: items.sort(sortByTitle) }));
  });

  const collectionName = (id: number | null) => {
    const item = catalog.collections.find((item) => item.id === id);

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
      library = await (choose
        ? window.gameShelf.chooseLibraryRoot()
        : window.gameShelf.getLibraryState());
      const result = await window.gameShelf.getCatalog();

      if (result.ok) catalog = result.value;
      else
        notice = library?.message.includes('Rebuild catalog')
          ? library.message
          : result.message;
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
    const progressTimer = setInterval(() => {
      void refreshMatchingStatus();
    }, 300);

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
    const get = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement).value;
    const checked = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement).checked;
    const result = await window.gameShelf.saveSettings({
      collectionPrefix: get('prefix'),
      showCollectionGames: checked('visible'),
      matchingThreshold: Number(get('threshold')),
      greedyMatch: checked('greedy-match'),
      defaultSort: get('sort') as 'title' | 'releaseDate',
      providerOrder: get('order')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
      providers: {
        igdb: {
          enabled: checked('igdb'),
          configured: settings!.providers.igdb.configured,
        },
        thegamesdb: {
          enabled: checked('thegamesdb'),
          configured: settings!.providers.thegamesdb.configured,
        },
        steamgriddb: {
          enabled: checked('steamgriddb'),
          configured: settings!.providers.steamgriddb.configured,
        },
      },
      credentials: {
        igdbClientId: get('igdb-client'),
        igdbClientSecret: get('igdb-secret'),
        thegamesdbApiKey: get('thegamesdb-key'),
        steamgriddbApiKey: get('steamgriddb-key'),
      },
    });

    if (result.ok) settings = result.value;
    notice = result.ok ? 'Settings saved.' : result.message;
  }

  onMount(() => {
    window.gameShelf
      .getAppInfo()
      .then((info) => {
        version = info.version;
      })
      .catch(() => {
        notice = 'Unable to read app information.';
      });
    void refresh();
    void refreshMatchingStatus();
    window.gameShelf.getSettings().then((result) => {
      if (result.ok) settings = result.value;
    });

    const keys = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      const isEditing =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement;
      const isArrowKey = [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
      ].includes(event.key);

      if (isEditing || !isArrowKey || !games.length) return;

      event.preventDefault();

      const current = Math.max(
        0,
        games.findIndex((game) => game.id === selectedId)
      );
      const columns = Math.max(1, Math.floor((window.innerWidth - 300) / 152));
      const offset =
        event.key === 'ArrowLeft'
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
      <div>
        <p class="eyebrow">YOUR PORTABLE GAME CATALOG</p>
        <h1>GameShelf</h1>
      </div>
      <p class="version">{version ? `Version ${version}` : ''}</p>
    </header>

    <nav class="pages" aria-label="Library views">
      <button
        class:active={page === 'home'}
        aria-pressed={page === 'home'}
        onclick={() => {
          page = 'home';
          needsMatching = false;
          collectionId = null;
        }}>⌂ <span>Home</span></button
      >
      <button
        class:active={page === 'games'}
        aria-pressed={page === 'games'}
        onclick={() => {
          page = 'games';
          needsMatching = false;
          collectionId = null;
        }}>▦ <span>All Games</span></button
      >
      <button
        class:active={page === 'collections'}
        aria-pressed={page === 'collections'}
        onclick={openCollectionsOverview}>▤ <span>Collections</span></button
      >
    </nav>

    <section class="status-card sidebar-status" aria-label="Library status">
      <div><strong>{catalog.games.length}</strong><span>Games</span></div>
      <div>
        <strong>{catalog.collections.length}</strong><span>Collections</span>
      </div>
      <button
        onclick={() => {
          page = 'games';
          needsMatching = true;
          collectionId = null;
        }}
        ><strong
          >{catalog.games.filter((game) => game.matchStatus === 'unmatched')
            .length}</strong
        ><span>Needs matching</span></button
      >
    </section>
    <section class="matching-status" aria-label="Matching status">
      <strong
        >{matchingStatus.phase === 'matching'
          ? `Matching ${matchingStatus.attempted}/${matchingStatus.total}`
          : matchingStatus.phase === 'scanning'
            ? 'Scanning library'
            : matchingStatus.phase === 'complete'
              ? 'Matching complete'
              : 'Matching ready'}</strong
      ><span
        >{matchingStatus.message ||
          'Run Scan library in Settings to match unresolved games.'}</span
      >{#if matchingStatus.gameName && matchingStatus.phase === 'matching'}<small
          >{matchingStatus.gameName} · {matchingStatus.matched} matched</small
        >{/if}
    </section>
    {#if notice}<p class="sidebar-notice" role="status" aria-live="polite">
        {notice}
      </p>{/if}
    <div class="sidebar-footer">
      <button
        class="settings-link"
        class:active={page === 'settings'}
        aria-pressed={page === 'settings'}
        onclick={() => (page = 'settings')}>⚙ <span>Settings</span></button
      >
      <a
        class="author-link"
        href="https://github.com/rajatsnvsingh"
        target="_blank"
        rel="noreferrer">Made with ❤️ by Rajat Singh</a
      >
    </div>
  </aside>

  <section class="workspace">
    {#if page === 'settings' && settings}
      <SettingsPanel
        {settings}
        {library}
        {catalog}
        {busy}
        onScan={scan}
        onFetchMissingMetadata={fetchMissingMetadata}
        onRefresh={refresh}
        onSave={saveSettings}
        onCatalog={(value) => (catalog = value)}
        onLibrary={(value) => (library = value)}
        onNotice={(value) => (notice = value)}
      />
    {:else}
      <div
        class="catalog"
        class:detail-open={selected !== undefined}
        aria-busy={busy}
      >
        <nav aria-label="Collections">
          <h2>Collections</h2>
          <button
            class:active={collectionId === null && !needsMatching}
            aria-pressed={collectionId === null && !needsMatching}
            onclick={() => {
              page = 'games';
              needsMatching = false;
              collectionId = null;
              selectedId = null;
            }}>All games <span>{catalog.games.length}</span></button
          >
          <button
            class:active={needsMatching}
            aria-pressed={needsMatching}
            onclick={() => {
              page = 'games';
              needsMatching = true;
              collectionId = null;
              selectedId = null;
            }}
            >Needs Matching <span
              >{catalog.games.filter((game) => game.matchStatus === 'unmatched')
                .length}</span
            ></button
          >
          {#each catalog.collections as item (item.id)}
            <button
              class:active={collectionId === item.id}
              aria-pressed={collectionId === item.id}
              onclick={() => openCollection(item.id)}
            >
              {item.displayName || item.folderName}
              <span
                >{catalog.games.filter((game) => game.collectionId === item.id)
                  .length}</span
              >
              {#if item.missing}<small class="missing">Missing</small>{/if}
            </button>
          {/each}
          {#if catalog.collections.length === 0}<p class="muted">
              No collections yet.
            </p>{/if}
        </nav>

        <section class="game-list" aria-label="Games">
          {#if page === 'home'}<div class="home">
              <h2>Home</h2>
              <section class="home-section">
                <h3>Collections</h3>
                {#if catalog.collections.length === 0}<p class="empty">
                    No collections yet.
                  </p>{:else}<div class="collection-grid">
                    {#each catalog.collections as item (item.id)}{@const artwork =
                        catalog.games.find(
                          (game) =>
                            game.collectionId === item.id && game.coverUrl
                        )?.coverUrl}<CollectionCard
                        collection={item}
                        {artwork}
                        onOpen={openCollection}
                      />{/each}
                  </div>{/if}
              </section>
              {#if recentlyAdded.length}<section class="home-section">
                  <h3>Recently added</h3>
                  <div class="game-grid home-grid">
                    {#each recentlyAdded as game (game.id)}<GameCard
                        {game}
                        showAddedAt
                        onSelect={selectGame}
                      />{/each}
                  </div>
                </section>{/if}
              <section class="home-section">
                <div class="group-heading">
                  <h3>Library</h3>
                  <label
                    >Group by <select bind:value={homeGroupBy}
                      ><option value="decade">Release decade</option><option
                        value="genre">Genre</option
                      ></select
                    ></label
                  >
                </div>
                {#if homeGroups.length === 0}<p class="empty">
                    No games yet. Choose your folder, then select Scan library.
                  </p>{:else}{#each homeGroups as group (group.label)}<section
                      class="home-group"
                    >
                      <h3>
                        {group.label}
                        <span class="count">{group.games.length}</span>
                      </h3>
                      <div class="game-grid home-grid">
                        {#each group.games as game (game.id)}<GameCard
                            {game}
                            showGenreYear={homeGroupBy === 'genre'}
                            onSelect={selectGame}
                          />{/each}
                      </div>
                    </section>{/each}{/if}
              </section>
            </div>{/if}
          {#if page === 'collections' && collectionId === null}<div
              class="home"
            >
              <h2>Collections</h2>
              {#if catalog.collections.length === 0}<p class="empty">
                  No collections yet.
                </p>{:else}<div class="collection-grid">
                  {#each catalog.collections as item (item.id)}{@const artwork =
                      catalog.games.find(
                        (game) => game.collectionId === item.id && game.coverUrl
                      )?.coverUrl}<CollectionCard
                      collection={item}
                      {artwork}
                      onOpen={openCollection}
                    />{/each}
                </div>{/if}
            </div>{/if}
          {#if page === 'games' || (page === 'collections' && collectionId !== null)}
            <div class="filters" aria-label="Game filters">
              <label class="search-filter"
                ><span class="search-icon" aria-hidden="true"
                  ><svg viewBox="0 0 24 24"
                    ><circle cx="11" cy="11" r="6.5"></circle><path
                      d="m16 16 4 4"
                    ></path></svg
                  ></span
                ><input
                  bind:value={titleFilter}
                  placeholder="Search your library"
                /></label
              ><label
                >Year <select bind:value={yearFilter}
                  ><option value="">All years</option
                  >{#each years as year}<option value={String(year)}
                      >{year}</option
                    >{/each}</select
                ></label
              ><label
                >Genre <select bind:value={genreFilter}
                  ><option value="">All genres</option
                  >{#each genres as genre}<option value={genre}>{genre}</option
                    >{/each}</select
                ></label
              ><label
                >Collection <select bind:value={collectionFilter}
                  ><option value="all">All collections</option><option
                    value="none">No collection</option
                  >{#each catalog.collections as item}<option
                      value={String(item.id)}
                      >{item.displayName || item.folderName}</option
                    >{/each}</select
                ></label
              ><label
                >Sort <select bind:value={sort}
                  ><option value="title">Title</option><option
                    value="releaseDate">Release date</option
                  ></select
                ></label
              >
            </div>
            <div class="list-heading">
              {#if page === 'collections' && collection}<button
                  class="back"
                  onclick={backFromCollection}>← Back</button
                >{/if}
              <h2>
                {needsMatching
                  ? 'Needs Matching'
                  : collection
                    ? collection.displayName || collection.folderName
                    : 'All games'} <span class="count">{games.length}</span>
              </h2>
            </div>
            {#if games.length === 0}
              <p class="empty">
                {needsMatching
                  ? 'No games need matching.'
                  : collection
                    ? 'This collection has no cataloged games.'
                    : 'No games yet. Choose your folder, then select Scan library.'}
              </p>
            {:else}
              <ul class="game-grid">
                {#each games as game (game.id)}
                  <li>
                    <GameCard
                      {game}
                      active={selectedId === game.id}
                      showMetadata
                      collectionName={game.collectionId !== null
                        ? collectionName(game.collectionId)
                        : undefined}
                      onSelect={selectGame}
                    />
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        </section>

        {#if selected}<GameDetails
            game={selected}
            collection={selectedCollection}
            {settings}
            onCatalog={(value) => (catalog = value)}
            onNotice={(value) => (notice = value)}
            onClose={() => (selectedId = null)}
            onOpenCollection={openCollection}
          />{/if}
      </div>
    {/if}
  </section>
</main>
