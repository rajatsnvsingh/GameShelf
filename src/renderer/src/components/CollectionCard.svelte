<!-- Presents one collection and delegates selection to its parent view. -->
<script lang="ts">
  import type { CatalogCollection } from '../../../shared/api';

  let {
    collection,
    artwork,
    onOpen,
  }: {
    collection: CatalogCollection;
    artwork?: string;
    onOpen: (id: number) => void;
  } = $props();

  const title = () => collection.displayName || collection.folderName;
</script>

<button class="collection-card" onclick={() => onOpen(collection.id)}>
  {#if artwork}
    <img src={artwork} alt="" />
  {:else}
    <span class="card-placeholder">Collection</span>
  {/if}

  <span>{title()}</span>
  {#if collection.missing}<small class="missing">Missing</small>{/if}
</button>

<style>
  .collection-card {
    position: relative;
    min-height: 180px;
    overflow: hidden;
    padding: 0;
    display: grid;
    place-items: end start;
    text-align: left;
    border: 1px solid #566380;
    border-radius: 6px;
    background: #293246;
    color: #edf0f6;
    font: inherit;
    cursor: pointer;
  }
  .collection-card:hover {
    background: #35446a;
  }
  .collection-card:focus-visible {
    outline: 2px solid #aabaff;
    outline-offset: 3px;
  }
  .collection-card img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.42;
    filter: saturate(0.7) brightness(0.65);
  }
  .card-placeholder {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    color: #a5b0c6;
  }
  .collection-card > span:not(.card-placeholder),
  small {
    position: relative;
    z-index: 1;
    width: 100%;
    padding: 12px;
    background: linear-gradient(transparent, rgb(10 14 20 / 0.9));
    font-size: 17px;
    font-weight: 700;
  }
  small {
    padding-top: 0;
    color: #bcc5d5;
    font-size: 12px;
  }
  .missing {
    color: #f0c18c;
  }
</style>
