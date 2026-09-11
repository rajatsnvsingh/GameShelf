/** Adapts SteamGridDB artwork records without allowing it to bind descriptive metadata. */
import type {
  GameDetails,
  MetadataProvider,
  SearchCandidate,
} from './provider.ts';

export type { SteamGridDbSettings } from './provider-settings.types';
import type { SteamGridDbSettings } from './provider-settings.types';
/** Reports a safe SteamGridDB failure without exposing credentials or response data. */
export class SteamGridDbError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`SteamGridDB: ${code}.`);
    this.code = code;
  }
}
type Row = Record<string, unknown>;
const row = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SteamGridDbError('invalid-response');

  return value as Row;
};

/** SteamGridDB supplies artwork only; its records never become metadata bindings. */
export class SteamGridDbProvider implements MetadataProvider {
  readonly id = 'steamgriddb';
  readonly capabilities = {
    artwork: ['cover', 'background'] as const,
    metadata: false as const,
  };
  private readonly settings: SteamGridDbSettings;
  private readonly fetcher: typeof fetch;
  constructor(
    settings: SteamGridDbSettings,
    fetcher: typeof fetch = globalThis.fetch
  ) {
    this.settings = settings;
    this.fetcher = fetcher;
  }
  private async request(path: string): Promise<unknown> {
    if (!this.settings.enabled) throw new SteamGridDbError('disabled');
    if (!this.settings.apiKey.trim())
      throw new SteamGridDbError('unconfigured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetcher(
        `https://www.steamgriddb.com/api/v2${path}`,
        {
          headers: { Authorization: `Bearer ${this.settings.apiKey}` },
          redirect: 'error',
          signal: controller.signal,
        }
      );
      if (!response.ok)
        throw new SteamGridDbError(
          response.status === 429 ? 'rate-limited' : 'http-error'
        );
      const envelope = row((await response.json()) as unknown);
      if (envelope.success !== true)
        throw new SteamGridDbError('invalid-response');

      return envelope.data;
    } catch (error) {
      throw error instanceof SteamGridDbError
        ? error
        : new SteamGridDbError(
            controller.signal.aborted ? 'timeout' : 'request-failed'
          );
    } finally {
      clearTimeout(timer);
    }
  }
  async search(query: string): Promise<SearchCandidate[]> {
    if (!query.trim() || query.length > 250 || /[\x00-\x1f]/.test(query))
      throw new SteamGridDbError('invalid-query');
    const data = await this.request(
      `/search/autocomplete/${encodeURIComponent(query)}`
    );
    if (!Array.isArray(data) || data.length > 50)
      throw new SteamGridDbError('invalid-response');

    return data.map((value) => {
      const item = row(value);
      if (
        !Number.isSafeInteger(item.id) ||
        (item.id as number) <= 0 ||
        typeof item.name !== 'string' ||
        !item.name.trim()
      )
        throw new SteamGridDbError('invalid-response');

      return { recordId: String(item.id), title: item.name };
    });
  }
  async getGame(recordId: string): Promise<GameDetails | null> {
    if (!/^[1-9]\d*$/.test(recordId))
      throw new SteamGridDbError('invalid-record-id');
    const game = row(await this.request(`/games/${recordId}`));
    if (typeof game.name !== 'string' || !game.name.trim())
      throw new SteamGridDbError('invalid-response');
    const images = async (path: string, kind: 'cover' | 'background') => {
      const data = await this.request(path);
      if (!Array.isArray(data)) throw new SteamGridDbError('invalid-response');

      return data.flatMap((value) => {
        const item = row(value);

        return typeof item.url === 'string' && /^https:\/\//.test(item.url)
          ? [{ kind, url: item.url }]
          : [];
      });
    };
    const [covers, backgrounds] = await Promise.all([
      images(`/grids/game/${recordId}`, 'cover'),
      images(`/heroes/game/${recordId}`, 'background'),
    ]);

    return { recordId, title: game.name, artwork: [...covers, ...backgrounds] };
  }
}
