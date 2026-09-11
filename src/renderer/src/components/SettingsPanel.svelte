<!-- Displays durable settings and delegates saves and maintenance actions to the application. -->
<script lang="ts">
  import '../styles/settings-panel.css';
  import type {
    CatalogView,
    LibraryState,
    SettingsView,
  } from '../../../shared/api';

  type SettingsTab = 'general' | 'library' | 'providers';
  let {
    settings,
    library,
    catalog,
    busy,
    onScan,
    onFetchMissingMetadata,
    onRefresh,
    onSave,
    onCatalog,
    onLibrary,
    onNotice,
  }: {
    settings: SettingsView;
    library?: LibraryState;
    catalog: CatalogView;
    busy: boolean;
    onScan: () => void;
    onFetchMissingMetadata: () => void;
    onRefresh: (choose?: boolean) => void;
    onSave: (form: HTMLFormElement) => void;
    onCatalog: (catalog: CatalogView) => void;
    onLibrary: (library: LibraryState) => void;
    onNotice: (notice: string) => void;
  } = $props();
  let tab = $state<SettingsTab>('general');

  async function deleteMissing() {
    if (
      !confirm(
        'Remove all records currently marked missing? This cannot be undone.'
      )
    )
      return;
    const result = await window.gameShelf.deleteMissing();
    if (result.ok) onCatalog(result.value);
    onNotice(result.message || '');
  }
  async function rebuild() {
    if (
      !confirm(
        'Rebuild the catalog from the selected library? This removes saved matches, manual metadata, and artwork associations.'
      )
    )
      return;
    const result = await window.gameShelf.rebuildCatalog();
    if (result.ok) onCatalog(result.value);
    onNotice(result.message || '');
  }
  async function wipe() {
    if (
      !confirm(
        'Wipe all catalog records, cached artwork, and logs? Your library selection, settings, provider credentials, game folders, and archives will not be changed.'
      )
    )
      return;
    const result = await window.gameShelf.wipeLibrary();
    if (result.ok) {
      onCatalog({ games: [], collections: [] });
      onLibrary(await window.gameShelf.getLibraryState());
    }
    onNotice(result.message || '');
  }
</script>

<section class="setup settings-panel" aria-label="Settings">
  <h2>Settings</h2>
  <div class="settings-tabs" role="tablist" aria-label="Settings sections">
    <button
      type="button"
      role="tab"
      aria-selected={tab === 'general'}
      class:active={tab === 'general'}
      onclick={() => (tab = 'general')}>General</button
    >
    <button
      type="button"
      role="tab"
      aria-selected={tab === 'library'}
      class:active={tab === 'library'}
      onclick={() => (tab = 'library')}>Library</button
    >
    <button
      type="button"
      role="tab"
      aria-selected={tab === 'providers'}
      class:active={tab === 'providers'}
      onclick={() => (tab = 'providers')}>Providers</button
    >
  </div>
  <form
    class="settings-form"
    onsubmit={(event) => {
      event.preventDefault();
      onSave(event.currentTarget);
    }}
  >
    <div
      class="settings-tab-panel"
      role="tabpanel"
      aria-label="General settings"
      hidden={tab !== 'general'}
    >
      <h3>General</h3>
      <label
        >Default sort <select name="sort" value={settings.defaultSort}
          ><option value="title">Title</option><option value="releaseDate"
            >Release date</option
          ></select
        ></label
      >
    </div>
    <div
      class="settings-tab-panel"
      role="tabpanel"
      aria-label="Library settings"
      hidden={tab !== 'library'}
    >
      <h3>Library</h3>
      <section class="library-setup" aria-label="Library setup">
        <h3>
          {library?.status === 'ready'
            ? 'Library ready'
            : library?.status === 'unavailable'
              ? 'Library unavailable'
              : 'Choose your library'}
        </h3>
        {#if library?.root}<p class="path">{library.root}</p>{/if}
        <div class="settings-actions">
          <button
            type="button"
            class="primary"
            disabled={busy || library?.status !== 'ready'}
            onclick={onScan}>Scan library</button
          ><button
            type="button"
            disabled={busy ||
              catalog.games.every((game) => game.matchStatus !== 'matched')}
            onclick={onFetchMissingMetadata}>Fetch missing metadata</button
          ><button
            type="button"
            disabled={busy || !library || library.status === 'config-error'}
            onclick={() => onRefresh(true)}>Choose library folder</button
          ><button type="button" disabled={busy} onclick={() => onRefresh()}
            >Retry</button
          >
        </div>
        <p class="muted">
          {library?.message || 'Loading…'} Fetch missing metadata checks existing
          matches through their configured provider and fills data added by newer
          GameShelf versions without replacing your manual work.
        </p>
      </section>
      <label
        >Collection prefix <input
          name="prefix"
          value={settings.collectionPrefix}
        /></label
      ><label class="checkbox-label"
        ><input
          name="visible"
          type="checkbox"
          checked={settings.showCollectionGames}
        /> Show collection games in main library</label
      >
      <section class="matching catalog-maintenance">
        <h3>Catalog maintenance</h3>
        <p class="muted">
          These actions affect catalog records only. They never alter installer
          folders.
        </p>
        <div class="settings-actions">
          <button type="button" onclick={deleteMissing}
            >Remove missing records</button
          ><button type="button" onclick={rebuild}>Rebuild catalog</button
          ><button type="button" class="danger" onclick={wipe}
            >Wipe library</button
          >
        </div>
      </section>
    </div>
    <div
      class="settings-tab-panel"
      role="tabpanel"
      aria-label="Provider settings"
      hidden={tab !== 'providers'}
    >
      <h3>Providers</h3>
      <p class="muted">Credentials are never shown after saving.</p>
      <label
        >Matching threshold <input
          name="threshold"
          type="number"
          min="0"
          max="1"
          step="0.01"
          value={settings.matchingThreshold}
        /></label
      ><label class="greedy-match"
        ><input
          name="greedy-match"
          type="checkbox"
          checked={settings.greedyMatch}
        />
        Greedy match
        <small
          >Always accept the first result ranked by the first provider that
          returns one.</small
        ></label
      ><label
        >Provider order <input
          name="order"
          value={settings.providerOrder.join(',')}
        /></label
      >
      <fieldset>
        <legend>Provider credentials</legend><label
          ><input
            name="igdb"
            type="checkbox"
            checked={settings.providers.igdb.enabled}
          />
          IGDB {settings.providers.igdb.configured
            ? 'configured'
            : 'not configured'}</label
        ><input name="igdb-client" placeholder="New IGDB client ID" /><input
          name="igdb-secret"
          type="password"
          placeholder="New IGDB client secret"
        /><label
          ><input
            name="thegamesdb"
            type="checkbox"
            checked={settings.providers.thegamesdb.enabled}
          />
          TheGamesDB {settings.providers.thegamesdb.configured
            ? 'configured'
            : 'not configured'}</label
        ><input
          name="thegamesdb-key"
          type="password"
          placeholder="New TheGamesDB API key"
        /><label
          ><input
            name="steamgriddb"
            type="checkbox"
            checked={settings.providers.steamgriddb.enabled}
          />
          SteamGridDB {settings.providers.steamgriddb.configured
            ? 'configured'
            : 'not configured'}</label
        ><input
          name="steamgriddb-key"
          type="password"
          placeholder="New SteamGridDB API key"
        />
        <p class="muted">
          SteamGridDB supplies cover and banner art only. After a game is
          matched, use Fetch artwork on its details page to request missing
          assets.
        </p>
      </fieldset>
    </div>
    <button class="primary save-settings">Save settings</button>
  </form>
</section>
