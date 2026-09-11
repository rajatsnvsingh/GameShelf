<script lang="ts">
  import type { CatalogGame } from '../../../shared/api';

  let {
    game,
    active = false,
    showAddedAt = false,
    showGenreYear = false,
    showMetadata = false,
    collectionName,
    onSelect
  }: {
    game: CatalogGame;
    active?: boolean;
    showAddedAt?: boolean;
    showGenreYear?: boolean;
    showMetadata?: boolean;
    collectionName?: string;
    onSelect: (id: number) => void;
  } = $props();

  const title = () => game.metadata.title || game.folderName;
  const formatDate = (value: string) => new Date(value).toLocaleString();
</script>

<button
  class="game-card"
  class:active
  aria-pressed={active}
  onclick={() => onSelect(game.id)}
>
  {#if game.coverUrl}
    <img src={game.coverUrl} alt={`Cover for ${title()}`} />
  {:else}
    <span class="card-placeholder" aria-hidden="true">No cover</span>
  {/if}

  {#if game.matchStatus === 'unmatched'}
    <span class="match-warning" title="Needs matching" aria-label="Needs matching">!</span>
  {/if}

  <span class="card-copy">
    <strong>{title()}</strong>

    {#if showAddedAt}
      <small>{formatDate(game.addedAt)}</small>
    {:else if showGenreYear && game.metadata.releaseYear}
      <small>{game.metadata.releaseYear}</small>
    {:else if showMetadata}
      <span class="card-meta">
        {#if game.metadata.releaseYear}<small>{game.metadata.releaseYear}</small>{/if}
        {#if game.metadata.rating !== undefined}<small>★ {game.metadata.rating.toFixed(0)}</small>{/if}
        {#if collectionName}<small>{collectionName}</small>{/if}
        {#if game.missing}<small class="missing">Missing</small>{/if}
      </span>
    {/if}
  </span>
</button>

<style>
  .game-card { position: relative; width: 100%; aspect-ratio: 2 / 3; min-height: 0; padding: 0; overflow: hidden; text-align: left; background: #171b24; border: 1px solid #566380; border-radius: 6px; color: #edf0f6; font: inherit; cursor: pointer; }
  .game-card:hover { background: #35446a; }
  .game-card.active { border-color: #aabaff; background: #33436b; }
  .game-card:focus-visible { outline: 2px solid #aabaff; outline-offset: 3px; }
  .game-card img, .game-card .card-placeholder { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #171b24; }
  .card-placeholder { display: grid; place-items: center; color: #a5b0c6; font-size: 12px; }
  .card-copy { position: absolute; z-index: 1; right: 0; bottom: 0; left: 0; display: block; padding: 32px 11px 11px; background: linear-gradient(transparent, rgb(10 14 20 / .94) 42%); }
  .card-copy strong { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; color: #fff; line-height: 1.25; }
  .card-meta { display: flex; flex-wrap: wrap; gap: 4px 9px; }
  small { display: block; margin-top: 4px; color: #bcc5d5; font-size: 12px; }
  .card-meta small { margin: 5px 0 0; }
  .missing { color: #f0c18c; }
  .match-warning { position: absolute; z-index: 1; top: 8px; right: 8px; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: #f0c84b; color: #342900; font-size: 17px; font-weight: 900; box-shadow: 0 2px 8px #0009; }
</style>
