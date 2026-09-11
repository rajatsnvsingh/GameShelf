/** Caches validated provider artwork locally and returns safe renderer asset paths. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtworkReference } from '../metadata/provider.ts';

/** Signals that a provider image failed validation, download, or local persistence. */
export class ArtworkError extends Error {
  constructor() {
    super('Artwork download failed.');
  }
}

function extension(
  bytes: Uint8Array,
  type: string | null
): 'jpg' | 'png' | 'webp' | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return 'jpg';
  if (
    bytes.length >= 8 &&
    Buffer.from(bytes.slice(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )
  )
    return 'png';
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.slice(0, 4)).toString() === 'RIFF' &&
    Buffer.from(bytes.slice(8, 12)).toString() === 'WEBP'
  )
    return 'webp';

  return type?.startsWith('image/') ? null : null;
}

/** Main-only provider artwork cache. Local names are opaque and never derived from remote paths. */
export class ArtworkCache {
  private readonly base: string;
  private readonly fetcher: typeof fetch;
  constructor(
    base: string,
    fetcher: typeof fetch = (url, init) => globalThis.fetch(url, init)
  ) {
    this.base = base;
    this.fetcher = fetcher;
  }

  async download(
    gameId: number,
    artwork: ArtworkReference | { kind: 'screenshot'; url: string },
    preview = false
  ): Promise<string> {
    if (
      !Number.isSafeInteger(gameId) ||
      gameId <= 0 ||
      !['cover', 'background', 'screenshot'].includes(artwork.kind)
    )
      throw new ArtworkError();
    let url: URL;
    try {
      url = new URL(artwork.url);
    } catch {
      throw new ArtworkError();
    }
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new ArtworkError();
    if (
      artwork.kind === 'screenshot' &&
      (url.origin !== 'https://images.igdb.com' ||
        !/^\/igdb\/image\/upload\/t_1080p\/[a-zA-Z0-9_-]+\.jpg$/.test(
          url.pathname
        ) ||
        url.search ||
        url.hash)
    )
      throw new ArtworkError();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetcher(url, {
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new ArtworkError();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 10 * 1024 * 1024) {
            await reader.cancel();
            throw new ArtworkError();
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = Buffer.concat(chunks);
      const suffix = extension(bytes, response.headers.get('content-type'));
      if (!suffix) throw new ArtworkError();
      const directory = join(this.base, 'data', 'artwork');
      await mkdir(directory, { recursive: true });
      const name = `${gameId}-${artwork.kind}-${createHash('sha256')
        .update(artwork.url)
        .update(preview ? '\0preview' : '')
        .digest('hex')
        .slice(0, 24)}.${suffix}`;
      const target = join(directory, name);
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, 'wx');
        try {
          await file.writeFile(bytes);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, target);
      } finally {
        await unlink(temporary).catch(() => {});
      }

      return name;
    } catch (error) {
      throw error instanceof ArtworkError ? error : new ArtworkError();
    } finally {
      clearTimeout(timer);
    }
  }

  async saveManualPng(gameId: number, png: Uint8Array): Promise<string> {
    if (
      !Number.isSafeInteger(gameId) ||
      gameId <= 0 ||
      png.length < 8 ||
      !Buffer.from(png.slice(0, 8)).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      ) ||
      png.length > 10 * 1024 * 1024
    )
      throw new ArtworkError();
    const directory = join(this.base, 'data', 'artwork');
    await mkdir(directory, { recursive: true });
    const name = `${gameId}-manual-${createHash('sha256').update(png).digest('hex').slice(0, 24)}.png`;
    const target = join(directory, name);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx');
      try {
        await file.writeFile(png);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }

    return name;
  }
}
