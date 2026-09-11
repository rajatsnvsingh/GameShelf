<script lang="ts">
  let { urls, title }: { urls: string[]; title: string } = $props();
  let dialog = $state<HTMLDialogElement>();
  let active = $state(0);
  let failed = $state<string[]>([]);
  const images = $derived(urls.slice(0, 5).filter(url => !failed.includes(url)));

  function enlarge(index: number) {
    active = index;
    dialog?.showModal();
  }

  function move(offset: number) {
    active = (active + offset + images.length) % images.length;
  }

  function unavailable(url: string) {
    failed = [...failed, url];
    active = Math.min(active, Math.max(0, images.length - 1));
    if (!images.length) dialog?.close();
  }
</script>

{#if images.length}
  <section class="screenshots" aria-label="Screenshots">
    <h3>Screenshots</h3>
    <div class="thumbnails">
      {#each images as url, index (url)}
        <button class="thumbnail" aria-label={`Enlarge screenshot ${index + 1}`} onclick={() => enlarge(index)}>
          <img src={url} alt={`${title} screenshot ${index + 1}`} onerror={() => unavailable(url)} />
        </button>
      {/each}
    </div>
    <dialog bind:this={dialog} aria-label={`${title} screenshots`} onkeydown={event => {
      event.stopPropagation();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        move(event.key === 'ArrowLeft' ? -1 : 1);
      }
    }}>
      <div class="viewer">
        <div class="toolbar">
          <span aria-live="polite">Screenshot {active + 1} of {images.length}</span>
          <button aria-label="Close screenshot viewer" onclick={() => dialog?.close()}>Close ×</button>
        </div>
        <img class="enlarged" src={images[active]} alt={`${title} screenshot ${active + 1}`} onerror={() => unavailable(images[active])} />
        <div class="navigation">
          <button aria-label="Previous screenshot" disabled={images.length < 2} onclick={() => move(-1)}>← Previous</button>
          <span>← → to browse · Esc to close</span>
          <button aria-label="Next screenshot" disabled={images.length < 2} onclick={() => move(1)}>Next →</button>
        </div>
      </div>
    </dialog>
  </section>
{/if}

<style>
  .screenshots { clear: both; margin: 20px 0; }
  h3 { font-size: 15px; margin: 0 0 10px; }
  .thumbnails { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px; }
  button { color: #edf0f6; background: #273451; border: 1px solid #677ab4; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
  button:focus-visible { outline: 2px solid #a9bdff; outline-offset: 3px; }
  button:disabled { opacity: .5; cursor: default; }
  .thumbnail { padding: 0; overflow: hidden; aspect-ratio: 16 / 9; }
  .thumbnail img { width: 100%; height: 100%; object-fit: cover; display: block; }
  dialog { width: min(1200px, 92vw); max-width: 92vw; max-height: 92vh; padding: 16px; box-sizing: border-box; color: #edf0f6; background: #171b24; border: 1px solid #677ab4; border-radius: 10px; }
  dialog::backdrop { background: rgb(0 0 0 / .85); }
  .viewer { display: flex; flex-direction: column; gap: 12px; }
  .toolbar, .navigation { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .enlarged { display: block; width: 100%; height: min(68vh, 675px); object-fit: contain; min-height: 0; }
  .navigation span { color: #b7c2d8; font-size: 12px; }
  @media (max-width: 550px) { .navigation span { display: none; } }
</style>
