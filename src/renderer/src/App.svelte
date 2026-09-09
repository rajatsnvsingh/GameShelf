<script lang="ts">
  import { onMount } from 'svelte';
  import type { CatalogView, LibraryState } from '../../shared/api';

  let version = $state('');
  let library = $state<LibraryState>();
  let catalog = $state<CatalogView>({ games: [], collections: [] });
  let busy = $state(false);
  let notice = $state('');
  let collectionId = $state<number | null>(null);
  let selectedId = $state<number | null>(null);
  const collection = $derived(catalog.collections.find(item => item.id === collectionId));
  const games = $derived(catalog.games.filter(game => collectionId === null || game.collectionId === collectionId));
  const selected = $derived(catalog.games.find(game => game.id === selectedId));
  const collectionName = (id: number | null) => {
    const item = catalog.collections.find(item => item.id === id);
    return item ? item.displayName || item.folderName : 'None';
  };
  const date = (value: string) => new Date(value).toLocaleString();

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
    notice = 'Scanning library…';
    try {
      const result = await window.gameShelf.scanLibrary();
      if (result.ok) catalog = result.value;
      notice = result.message ?? 'Scan complete.';
      library = await window.gameShelf.getLibraryState();
    } catch { notice = 'Unable to complete the scan. Please retry.'; }
    finally { busy = false; }
  }

  async function openFolder() {
    if (!selected) return;
    busy = true;
    try {
      const result = await window.gameShelf.openInstallFolder(selected.id);
      notice = result.message ?? 'Install folder opened.';
    } catch { notice = 'Unable to open the install folder. Please retry.'; }
    finally { busy = false; }
  }

  onMount(() => {
    window.gameShelf.getAppInfo().then(info => { version = info.version; }).catch(() => { notice = 'Unable to read app information.'; });
    void refresh();
  });
</script>

<main>
  <header>
    <div><p class="eyebrow">YOUR PORTABLE GAME CATALOG</p><h1>GameShelf</h1></div>
    <p class="version">{version ? `Version ${version}` : ''}</p>
  </header>

  <section class="setup" aria-label="Library setup">
    <h2>{library?.status === 'ready' ? 'Library ready' : library?.status === 'unavailable' ? 'Library unavailable' : 'Choose your library'}</h2>
    {#if library?.root}<p class="path">{library.root}</p>{/if}
    <div class="actions">
      <button class="primary" disabled={busy || library?.status !== 'ready'} onclick={scan}>Scan library</button>
      <button disabled={busy || !library || library.status === 'config-error'} onclick={() => refresh(true)}>Choose library folder</button>
      <button disabled={busy} onclick={() => refresh()}>Retry</button>
    </div>
    <p role="status" aria-live="polite">{notice || library?.message || 'Loading…'}</p>
  </section>

  <div class="catalog" aria-busy={busy}>
    <nav aria-label="Collections">
      <h2>Collections</h2>
      <button class:active={collectionId === null} aria-pressed={collectionId === null}
        onclick={() => { collectionId = null; selectedId = null; }}>All games <span>{catalog.games.length}</span></button>
      {#each catalog.collections as item (item.id)}
        <button class:active={collectionId === item.id} aria-pressed={collectionId === item.id}
          onclick={() => { collectionId = item.id; selectedId = null; }}>
          {item.displayName || item.folderName}
          <span>{catalog.games.filter(game => game.collectionId === item.id).length}</span>
          {#if item.missing}<small class="missing">Missing</small>{/if}
        </button>
      {/each}
      {#if catalog.collections.length === 0}<p class="muted">No collections yet.</p>{/if}
    </nav>

    <section class="game-list" aria-label="Games">
      <h2>{collection ? collection.displayName || collection.folderName : 'All games'} <span class="count">{games.length}</span></h2>
      {#if games.length === 0}
        <p class="empty">{collection ? 'This collection has no cataloged games.' : 'No games yet. Choose your folder, then select Scan library.'}</p>
      {:else}
        <ul>
          {#each games as game (game.id)}
            <li><button class:active={selectedId === game.id} aria-pressed={selectedId === game.id} onclick={() => { selectedId = game.id; }}>
              <strong>{game.folderName}</strong>
              {#if game.collectionId !== null}<small>{collectionName(game.collectionId)}</small>{/if}
              {#if game.missing}<small class="missing">Missing</small>{/if}
            </button></li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="details" aria-label="Game details">
      {#if selected}
        <h2>{selected.folderName}</h2>
        <dl>
          <dt>Status</dt><dd>{selected.missing ? 'Missing at last scan' : 'Present at last scan'}</dd>
          <dt>Folder within library</dt><dd class="path">{selected.relativePath}</dd>
          <dt>Collection</dt><dd>{collectionName(selected.collectionId)}</dd>
          <dt>Added</dt><dd>{date(selected.addedAt)}</dd>
          <dt>Last seen</dt><dd>{date(selected.lastSeenAt)}</dd>
        </dl>
        <button class="primary" disabled={busy} onclick={openFolder}>Open Install Folder</button>
      {:else}
        <h2>Game details</h2>
        <p class="muted">Select a game to see its folder and open it in Explorer.</p>
      {/if}
    </section>
  </div>
</main>

<style>
  :global(body) { margin: 0; background: #171b24; color: #edf0f6; font-family: system-ui, sans-serif; }
  :global(*) { box-sizing: border-box; }
  main { max-width: 1280px; margin: 0 auto; padding: 28px; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .eyebrow { color: #aabaff; font-size: 11px; letter-spacing: .12em; margin: 0; }
  h1 { font-size: 32px; margin: 4px 0 0; }
  h2 { font-size: 18px; margin: 0 0 12px; overflow-wrap: anywhere; }
  p { color: #bcc5d5; line-height: 1.5; }
  .version, .muted, .path, [role='status'], .count { font-size: 13px; color: #bcc5d5; }
  .path { overflow-wrap: anywhere; }
  .setup, nav, .game-list, .details { padding: 20px; border: 1px solid #394154; border-radius: 10px; background: #202633; }
  .setup { margin-bottom: 20px; }
  .setup .path { margin: -4px 0 16px; }
  [role='status'] { margin-bottom: 0; min-height: 20px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  button { padding: 9px 12px; border: 1px solid #566380; border-radius: 6px; background: #293246; color: #edf0f6; font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
  button:hover { background: #35446a; }
  .primary { background: #435caa; border-color: #788bce; }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible { outline: 2px solid #aabaff; outline-offset: 3px; }
  .catalog { display: grid; grid-template-columns: 180px minmax(0, 1fr) 280px; gap: 16px; align-items: start; }
  nav button { width: 100%; margin-bottom: 8px; overflow-wrap: anywhere; }
  nav button span { float: right; margin-left: 8px; color: #bcc5d5; }
  button.active { border-color: #aabaff; background: #33436b; }
  ul { list-style: none; padding: 0; margin: 0; }
  li + li { margin-top: 8px; }
  li button { width: 100%; overflow-wrap: anywhere; }
  small { display: block; font-size: 12px; color: #bcc5d5; margin-top: 4px; }
  .missing { color: #f0c18c; }
  .count { margin-left: 6px; }
  .empty { margin: 20px 0; font-size: 14px; }
  dt { color: #a5b0c6; font-size: 12px; margin-top: 14px; }
  dd { margin: 4px 0 0; font-size: 13px; overflow-wrap: anywhere; }
  .details button { margin-top: 8px; }
  @media (max-width: 850px) {
    .catalog { grid-template-columns: 150px minmax(0, 1fr); }
    .details { grid-column: 1 / -1; }
  }
</style>
