/** Adapts TheGamesDB responses into normalized metadata with bounded network behavior. */
import type {
  GameDetails,
  MetadataProvider,
  SearchCandidate,
} from './provider.ts';

export type { TheGamesDbSettings } from './provider-settings.types';
import type { TheGamesDbSettings } from './provider-settings.types';
/** Reports a safe TheGamesDB failure without exposing credentials or response data. */
export class TheGamesDbError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`TheGamesDB: ${code}.`);
    this.name = 'TheGamesDbError';
    this.code = code;
  }
}
type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TheGamesDbError('invalid-response');

  return value as Row;
}
function candidate(value: unknown): SearchCandidate {
  const item = row(value);
  if (
    !Number.isSafeInteger(item.id) ||
    (item.id as number) <= 0 ||
    typeof item.game_title !== 'string' ||
    !item.game_title.trim()
  )
    throw new TheGamesDbError('invalid-response');
  const result: SearchCandidate = {
    recordId: String(item.id),
    title: item.game_title,
  };
  if (
    typeof item.release_date === 'string' &&
    /^[1-9]\d{3}(?:-|$)/.test(item.release_date)
  )
    result.releaseYear = Number(item.release_date.slice(0, 4));
  if (typeof item.image === 'string' && item.image.trim())
    result.hasArtwork = true;

  return result;
}
import type { ProviderRuntime as Runtime } from './provider-settings.types';
const defaults: Runtime = {
  fetch: (...args) => globalThis.fetch(...args),
  now: Date.now,
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs: 10_000,
};
const lookups = {
  developers: '/v1/Developers/ByDeveloperID',
  publishers: '/v1/Publishers/ByPublisherID',
  genres: '/v1/Genres/ByGenreID',
} as const;

/** Fixed API origin, one operation, no redirects; keys and response URLs never leave main. */
export class TheGamesDbProvider implements MetadataProvider {
  readonly id = 'thegamesdb';
  readonly capabilities = { artwork: [] as const };
  private readonly settings: TheGamesDbSettings;
  private readonly runtime: Runtime;
  private busy = false;
  private nextRequestAt = 0;
  private retryAt = 0;
  private names = new Map<string, string>();

  constructor(settings: TheGamesDbSettings, runtime: Partial<Runtime> = {}) {
    this.settings = { ...settings };
    this.runtime = { ...defaults, ...runtime };
  }
  private async operation<T>(work: () => Promise<T>): Promise<T> {
    if (!this.settings.enabled) throw new TheGamesDbError('disabled');
    if (!this.settings.apiKey.trim()) throw new TheGamesDbError('unconfigured');
    if (this.busy) throw new TheGamesDbError('busy');
    this.busy = true;
    try {
      return await work();
    } catch (error) {
      throw error instanceof TheGamesDbError
        ? error
        : new TheGamesDbError('request-failed');
    } finally {
      this.busy = false;
    }
  }
  private async request(
    path: string,
    parameters: Record<string, string>
  ): Promise<Row> {
    if (this.runtime.now() < this.retryAt)
      throw new TheGamesDbError('rate-limited');
    await this.runtime.sleep(
      Math.max(0, this.nextRequestAt - this.runtime.now())
    );
    this.nextRequestAt = this.runtime.now() + 300;
    const url = new URL(path, 'https://api.thegamesdb.net');
    url.search = new URLSearchParams({
      ...parameters,
      apikey: this.settings.apiKey,
    }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.runtime.timeoutMs);
    try {
      const response = await this.runtime.fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) {
          const value = response.headers.get('retry-after');
          const delay =
            value && /^\d+$/.test(value)
              ? Number(value) * 1000
              : value
                ? Date.parse(value) - this.runtime.now()
                : 1000;
          this.retryAt =
            this.runtime.now() +
            (Number.isFinite(delay) ? Math.max(1000, delay) : 1000);
          throw new TheGamesDbError('rate-limited');
        }
        // The provider uses 403 for both bad keys and exhausted allowance.
        throw new TheGamesDbError(
          response.status === 401 || response.status === 403
            ? 'key-or-quota-rejected'
            : 'http-error'
        );
      }
      if (!response.body) throw new TheGamesDbError('invalid-response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 2 * 1024 * 1024) {
            await reader.cancel();
            throw new TheGamesDbError('response-too-large');
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      let result: Row;
      try {
        result = row(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        throw new TheGamesDbError('invalid-response');
      }
      if (result.code !== 200)
        throw new TheGamesDbError(
          result.code === 403 ? 'key-or-quota-rejected' : 'invalid-response'
        );
      if (
        result.remaining_monthly_allowance === 0 &&
        (result.extra_allowance === 0 || result.extra_allowance === undefined)
      ) {
        const seconds = result.allowance_refresh_timer;
        this.retryAt =
          this.runtime.now() +
          (typeof seconds === 'number' &&
          Number.isFinite(seconds) &&
          seconds > 0
            ? seconds * 1000
            : 60_000);
      }

      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new TheGamesDbError('timeout');
      throw error instanceof TheGamesDbError
        ? error
        : new TheGamesDbError('request-failed');
    } finally {
      clearTimeout(timer);
    }
  }
  private games(result: Row): unknown[] {
    // Never follow provider pagination URLs: they contain keys and can name arbitrary hosts.
    const pages = row(result.pages);
    if (pages.next === undefined) throw new TheGamesDbError('invalid-response');
    if (pages.next !== null) throw new TheGamesDbError('search-too-broad');
    const data = row(result.data);
    if (
      !Array.isArray(data.games) ||
      data.games.length > 50 ||
      data.count !== data.games.length
    )
      throw new TheGamesDbError('invalid-response');

    return data.games;
  }
  async search(query: string): Promise<SearchCandidate[]> {
    if (!query.trim() || query.length > 250 || /[\x00-\x1f]/.test(query))
      throw new TheGamesDbError('invalid-query');
    try {
      return await this.operation(async () =>
        this.games(
          await this.request('/v1.1/Games/ByGameName', {
            name: query,
            page: '1',
          })
        ).map(candidate)
      );
    } catch (error) {
      // A paginated response is deliberately unusable, not an outage: skip it and let batch matching continue.
      if (error instanceof TheGamesDbError && error.code === 'search-too-broad')
        return [];
      throw error;
    }
  }
  private async resolveNames(
    kind: keyof typeof lookups,
    value: unknown
  ): Promise<string[]> {
    if (value == null) return [];
    if (
      !Array.isArray(value) ||
      value.length > 50 ||
      value.some((id) => !Number.isSafeInteger(id) || id <= 0)
    )
      throw new TheGamesDbError('invalid-response');
    const ids = [...new Set<number>(value)];
    const missing = ids.filter((id) => !this.names.has(`${kind}:${id}`));
    if (missing.length) {
      const data = row(
        (await this.request(lookups[kind], { id: missing.join(',') })).data
      );
      const records = row(data[kind]);
      const resolved = missing.map((id) => {
        const item = row(records[String(id)]);
        if (
          item.id !== id ||
          typeof item.name !== 'string' ||
          !item.name.trim()
        )
          throw new TheGamesDbError('invalid-response');

        return [id, item.name] as const;
      });
      for (const [id, name] of resolved) this.names.set(`${kind}:${id}`, name);
    }

    return [...new Set(ids.map((id) => this.names.get(`${kind}:${id}`)!))];
  }
  async getGame(recordId: string): Promise<GameDetails | null> {
    if (!/^[1-9]\d*$/.test(recordId) || !Number.isSafeInteger(Number(recordId)))
      throw new TheGamesDbError('invalid-record-id');

    return this.operation(async () => {
      const games = this.games(
        await this.request('/v1/Games/ByGameID', {
          id: recordId,
          fields: 'overview,publishers,genres',
        })
      );
      if (!games.length) return null;
      if (games.length !== 1) throw new TheGamesDbError('invalid-response');
      const game = row(games[0]);
      const details: GameDetails = { ...candidate(game), artwork: [] };
      if (details.recordId !== recordId)
        throw new TheGamesDbError('invalid-response');
      if (typeof game.overview === 'string' && game.overview.trim())
        details.description = game.overview;
      for (const kind of ['developers', 'publishers', 'genres'] as const) {
        const names = await this.resolveNames(kind, game[kind]);
        if (names.length) details[kind] = names;
      }
      // Provider rating is an age classification, not the normalized 0–100 review score.

      return details;
    });
  }
}
