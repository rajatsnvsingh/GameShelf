<script lang="ts">
  import { onMount } from 'svelte';
  let version = $state('');
  let failed = $state(false);

  onMount(() => {
    window.gameShelf.getAppInfo()
      .then((info) => { version = info.version; })
      .catch(() => { failed = true; });
  });
</script>

<main>
  <p class="eyebrow">YOUR PORTABLE GAME CATALOG</p>
  <h1>GameShelf</h1>
  <p>A home for your game library.</p>
  <section aria-label="Project status">
    <h2>Starting with the basics</h2>
    <p>The app foundation is ready. Library selection and browsing will arrive in later phases.</p>
    <p role="status">{failed ? 'Unable to read app information. Please restart GameShelf.' : version ? `Version ${version}` : 'Loading…'}</p>
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
</style>
