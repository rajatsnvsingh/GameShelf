<script lang="ts">
  import { onMount } from 'svelte';
  import type { LibraryState } from '../../shared/api';
  let version = $state('');
  let failed = $state(false);
  let library = $state<LibraryState>();
  let busy = $state(false);

  async function update(choose = false) {
    busy = true;
    failed = false;
    try { library = await (choose ? window.gameShelf.chooseLibraryRoot() : window.gameShelf.getLibraryState()); }
    catch { failed = true; }
    finally { busy = false; }
  }

  onMount(() => {
    window.gameShelf.getAppInfo()
      .then((info) => { version = info.version; })
      .catch(() => { failed = true; });
    void update();
  });
</script>

<main>
  <p class="eyebrow">YOUR PORTABLE GAME CATALOG</p>
  <h1>GameShelf</h1>
  <p>A home for your game library.</p>
  <section aria-label="Library setup">
    <h2>{library?.status === 'ready' ? 'Library ready' : 'Choose your library'}</h2>
    {#if library?.root}<p class="path">{library.root}</p>{/if}
    <p role="status">{failed ? 'Unable to read app information. Please retry.' : library?.message ?? 'Loading…'}</p>
    <button disabled={busy || !library || library.status === 'config-error'} onclick={() => update(true)}>Choose library folder</button>
    <button disabled={busy} onclick={() => update()}>Retry</button>
    <p>{version ? `Version ${version}` : ''}</p>
  </section>
</main>

<style>
  :global(body) { margin: 0; background: #171b24; color: #edf0f6; font-family: system-ui, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 72px 32px; }
  .eyebrow { color: #aabaff; font-size: 12px; letter-spacing: .12em; }
  h1 { font-size: 48px; margin: 12px 0; }
  h2 { font-size: 21px; }
  p { color: #bcc5d5; line-height: 1.6; }
  section { margin-top: 40px; padding: 24px; border: 1px solid #394154; border-radius: 12px; background: #202633; }
  [role='status'] { font-size: 14px; }
  .path { overflow-wrap: anywhere; }
  button { padding: 10px 16px; margin-right: 8px; border: 1px solid #7889bb; border-radius: 6px; background: #35446a; color: #fff; font: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible { outline: 2px solid #aabaff; outline-offset: 3px; }
</style>
