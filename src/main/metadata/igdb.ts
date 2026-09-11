import type { GameDetails, MetadataProvider, SearchCandidate } from './provider.ts';

export interface IgdbSettings { enabled: boolean; clientId: string; clientSecret: string }
export class IgdbError extends Error {
  readonly code: string;
  constructor(code: string) { super(`IGDB: ${code}.`); this.name = 'IgdbError'; this.code = code; }
}
type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IgdbError('invalid-response');
  return value as Row;
}
function candidate(value: unknown): SearchCandidate {
  const item = row(value);
  if (!Number.isSafeInteger(item.id) || (item.id as number) <= 0 || typeof item.name !== 'string' || !item.name.trim()) throw new IgdbError('invalid-response');
  const result: SearchCandidate = { recordId: String(item.id), title: item.name };
  if (typeof item.first_release_date === 'number') {
    const date = new Date(item.first_release_date * 1000);
    if (Number.isFinite(date.getTime())) result.releaseYear = date.getUTCFullYear();
  }
  if (item.cover && typeof item.cover === 'object' && !Array.isArray(item.cover) &&
    typeof (item.cover as Row).image_id === 'string' && /^[a-zA-Z0-9_-]+$/.test((item.cover as Row).image_id as string)) result.hasArtwork = true;
  return result;
}
function list(value: unknown): Row[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new IgdbError('invalid-response');
  return value.map(row);
}
function names(items: Row[]): string[] {
  return [...new Set(items.flatMap(item => typeof item.name === 'string' && item.name.trim() ? [item.name] : []))];
}
export function normalizeIgdbGame(value: unknown): GameDetails {
  const item = row(value);
  const details: GameDetails = { ...candidate(item), artwork: [] };
  if (typeof item.summary === 'string' && item.summary.trim()) details.description = item.summary;
  if (typeof item.total_rating === 'number' && Number.isFinite(item.total_rating) && item.total_rating >= 0 && item.total_rating <= 100) details.rating = item.total_rating;
  const companies = list(item.involved_companies);
  const developers = names(companies.filter(company => company.developer === true).map(company => row(company.company)));
  const publishers = names(companies.filter(company => company.publisher === true).map(company => row(company.company)));
  const genres = names(list(item.genres));
  if (developers.length) details.developers = developers;
  if (publishers.length) details.publishers = publishers;
  if (genres.length) details.genres = genres;
  // first_release_date can represent partial precision; keep its year, do not invent a day.
  const artwork: GameDetails['artwork'][number][] = [];
  const addImage = (image: Row, kind: 'cover' | 'background', size: string) => {
    if (typeof image.image_id === 'string' && /^[a-zA-Z0-9_-]+$/.test(image.image_id)) {
      artwork.push({ kind, url: `https://images.igdb.com/igdb/image/upload/t_${size}/${image.image_id}.jpg` });
    }
  };
  if (item.cover != null) addImage(row(item.cover), 'cover', 'cover_big');
  for (const image of list(item.artworks).slice(0, 5)) addImage(image, 'background', '1080p');
  details.artwork = artwork;
  return details;
}

interface Runtime {
  fetch: typeof globalThis.fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  timeoutMs: number;
}
const defaults: Runtime = { fetch: (...args) => globalThis.fetch(...args), now: Date.now,
  sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), timeoutMs: 10_000 };

/** One operation at a time, no unbounded queue, fixed origins, no redirects or persisted tokens. */
export class IgdbProvider implements MetadataProvider {
  readonly id = 'igdb';
  readonly capabilities = { artwork: ['cover', 'background'] as const };
  private readonly settings: IgdbSettings;
  private readonly runtime: Runtime;
  private busy = false;
  private token = '';
  private expiresAt = 0;
  private nextRequestAt = 0;
  private retryAt = 0;

  constructor(settings: IgdbSettings, runtime: Partial<Runtime> = {}) {
    this.settings = { ...settings };
    this.runtime = { ...defaults, ...runtime };
  }

  private async operation<T>(work: () => Promise<T>): Promise<T> {
    if (!this.settings.enabled) throw new IgdbError('disabled');
    if (!this.settings.clientId.trim() || !this.settings.clientSecret.trim()) throw new IgdbError('unconfigured');
    if (this.busy) throw new IgdbError('busy');
    if (this.runtime.now() < this.retryAt) throw new IgdbError('rate-limited');
    this.busy = true;
    try { return await work(); }
    catch (error) { throw error instanceof IgdbError ? error : new IgdbError('request-failed'); }
    finally { this.busy = false; }
  }

  private async request(url: string, body: string, headers: Record<string, string>): Promise<unknown> {
    await this.runtime.sleep(Math.max(0, this.nextRequestAt - this.runtime.now()));
    this.nextRequestAt = this.runtime.now() + 300;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.runtime.timeoutMs);
    try {
      const response = await this.runtime.fetch(url, { method: 'POST', body, headers, redirect: 'error', signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) {
          const value = response.headers.get('retry-after');
          const delay = value && /^\d+$/.test(value) ? Number(value) * 1000 : value ? Date.parse(value) - this.runtime.now() : 1000;
          this.retryAt = this.runtime.now() + (Number.isFinite(delay) ? Math.max(1000, delay) : 1000);
          throw new IgdbError('rate-limited');
        }
        throw new IgdbError(response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : 'http-error');
      }
      if (!response.body) throw new IgdbError('invalid-response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new IgdbError('response-too-large'); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new IgdbError('invalid-response'); }
    } catch (error) {
      if (controller.signal.aborted) throw new IgdbError('timeout');
      throw error instanceof IgdbError ? error : new IgdbError('request-failed');
    } finally { clearTimeout(timer); }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.runtime.now() < this.expiresAt) return this.token;
    const result = row(await this.request('https://id.twitch.tv/oauth2/token', new URLSearchParams({
      client_id: this.settings.clientId, client_secret: this.settings.clientSecret, grant_type: 'client_credentials'
    }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' }));
    if (typeof result.access_token !== 'string' || !/^[a-zA-Z0-9]+$/.test(result.access_token) ||
      typeof result.expires_in !== 'number' || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || result.token_type !== 'bearer') throw new IgdbError('invalid-token-response');
    this.token = result.access_token;
    this.expiresAt = this.runtime.now() + Math.max(0, result.expires_in - 60) * 1000;
    return this.token;
  }

  private async games(body: string): Promise<unknown[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken();
      try {
        const result = await this.request('https://api.igdb.com/v4/games', body, {
          'Client-ID': this.settings.clientId, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain', Accept: 'application/json'
        });
        if (!Array.isArray(result)) throw new IgdbError('invalid-response');
        return result;
      } catch (error) {
        if (error instanceof IgdbError && error.code === 'unauthorized') {
          this.token = ''; this.expiresAt = 0;
          if (attempt === 0) continue;
        }
        throw error;
      }
    }
    throw new IgdbError('unauthorized');
  }

  async search(query: string): Promise<SearchCandidate[]> {
    if (!query.trim() || query.length > 250 || /[\x00-\x1f]/.test(query)) throw new IgdbError('invalid-query');
    return this.operation(async () => {
      const escaped = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const result = await this.games(`search "${escaped}"; fields name,first_release_date,cover.image_id; limit 50;`);
      // IGDB caps `search` responses at the requested limit. Keep the ranked first page usable for
      // manual selection (for example, broad titles such as "Prototype") rather than reporting none.
      return result.map(candidate);
    });
  }

  async getGame(recordId: string): Promise<GameDetails | null> {
    if (!/^[1-9]\d*$/.test(recordId) || !Number.isSafeInteger(Number(recordId))) throw new IgdbError('invalid-record-id');
    return this.operation(async () => {
      const result = await this.games(`fields name,first_release_date,summary,total_rating,genres.name,involved_companies.developer,involved_companies.publisher,involved_companies.company.name,cover.image_id,artworks.image_id; where id = ${recordId}; limit 1;`);
      if (!result.length) return null;
      if (result.length !== 1) throw new IgdbError('invalid-response');
      const details = normalizeIgdbGame(result[0]);
      if (details.recordId !== recordId) throw new IgdbError('invalid-response');
      return details;
    });
  }
}
