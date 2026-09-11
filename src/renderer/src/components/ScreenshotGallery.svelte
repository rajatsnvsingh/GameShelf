<!-- Renders a bounded screenshot gallery and its keyboard-accessible lightbox. -->
<script lang="ts">
  import '../styles/screenshot-gallery.css';
  let { urls, title }: { urls: string[]; title: string } = $props();
  let dialog = $state<HTMLDialogElement>();
  let active = $state(0);
  let failed = $state<string[]>([]);
  const images = $derived(
    urls.slice(0, 5).filter((url) => !failed.includes(url))
  );

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
        <button
          class="thumbnail"
          aria-label={`Enlarge screenshot ${index + 1}`}
          onclick={() => enlarge(index)}
        >
          <img
            src={url}
            alt={`${title} screenshot ${index + 1}`}
            onerror={() => unavailable(url)}
          />
        </button>
      {/each}
    </div>
    <dialog
      bind:this={dialog}
      aria-label={`${title} screenshots`}
      onclick={(event) => {
        if (event.target === dialog) dialog?.close();
      }}
      onkeydown={(event) => {
        event.stopPropagation();
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          move(event.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
    >
      <div class="viewer">
        <div class="toolbar">
          <span aria-live="polite"
            >Screenshot {active + 1} of {images.length}</span
          >
          <button
            aria-label="Close screenshot viewer"
            onclick={() => dialog?.close()}>Close ×</button
          >
        </div>
        <img
          class="enlarged"
          src={images[active]}
          alt={`${title} screenshot ${active + 1}`}
          onerror={() => unavailable(images[active])}
        />
        <div class="navigation">
          <button
            aria-label="Previous screenshot"
            disabled={images.length < 2}
            onclick={() => move(-1)}>← Previous</button
          >
          <span>← → to browse · Esc to close</span>
          <button
            aria-label="Next screenshot"
            disabled={images.length < 2}
            onclick={() => move(1)}>Next →</button
          >
        </div>
      </div>
    </dialog>
  </section>
{/if}
