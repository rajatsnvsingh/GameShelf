import type Database from 'better-sqlite3';
import type { ScanResult } from '../library/scanner.ts';
import { catalogPath, validateDiscoveries } from './identity.ts';
import type { GameDetails, ProviderBinding } from '../metadata/provider.ts';
import { displayMetadata } from '../metadata/display.ts';

export interface CollectionRecord {
  id: number;
  relativePath: string;
  folderName: string;
  displayName: string;
  addedAt: string;
  lastSeenAt: string;
  missing: boolean;
}

export interface GameRecord {
  id: number;
  relativePath: string;
  folderName: string;
  collectionId: number | null;
  addedAt: string;
  lastSeenAt: string;
  missing: boolean;
  matchStatus: 'unmatched' | 'matched';
  bindingSource: 'automatic' | 'manual' | null;
  providerId: string | null;
  providerRecordId: string | null;
  confidence: number | null;
  providerMetadata: Record<string, unknown>;
  manualOverrides: Record<string, unknown>;
}
export interface ArtworkRecord { kind: 'cover' | 'background'; source: 'provider' | 'manual'; localPath: string; }

export class CatalogRepository {
  private readonly db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  listCollections(): CollectionRecord[] {
    const rows = this.db.prepare(`SELECT id, relative_path AS relativePath, folder_name AS folderName,
      display_name AS displayName, added_at AS addedAt, last_seen_at AS lastSeenAt, missing
      FROM collections ORDER BY path_key`).all() as (Omit<CollectionRecord, 'missing'> & { missing: number })[];
    return rows.map(row => ({ ...row, missing: Boolean(row.missing) }));
  }

  listGames(): GameRecord[] {
    const rows = this.db.prepare(`SELECT id, relative_path AS relativePath, folder_name AS folderName,
      collection_id AS collectionId, added_at AS addedAt, last_seen_at AS lastSeenAt, missing,
      match_status AS matchStatus, binding_source AS bindingSource, provider_id AS providerId,
      provider_record_id AS providerRecordId, confidence, provider_metadata AS providerMetadata,
      manual_overrides AS manualOverrides FROM games ORDER BY path_key`).all() as
      (Omit<GameRecord, 'missing' | 'providerMetadata' | 'manualOverrides'> & { missing: number; providerMetadata: string; manualOverrides: string })[];
    return rows.map(row => ({ ...row, missing: Boolean(row.missing),
      providerMetadata: JSON.parse(row.providerMetadata), manualOverrides: JSON.parse(row.manualOverrides) }));
  }

  listArtwork(gameId: number): ArtworkRecord[] {
    if (!Number.isSafeInteger(gameId) || gameId <= 0) throw new Error('Invalid game ID.');
    return this.db.prepare(`SELECT kind, source, local_path AS localPath FROM artwork WHERE game_id = ? ORDER BY kind`).all(gameId) as ArtworkRecord[];
  }

  saveProviderArtwork(gameId: number, kind: 'cover' | 'background', localPath: string, remoteUrl: string): boolean {
    if (!Number.isSafeInteger(gameId) || gameId <= 0 || !['cover', 'background'].includes(kind) ||
      !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(localPath) || !/^https:\/\//.test(remoteUrl)) throw new Error('Invalid artwork.');
    const result = this.db.prepare(`INSERT INTO artwork (game_id, kind, source, local_path, remote_url) VALUES (?, ?, 'provider', ?, ?)
      ON CONFLICT(game_id, kind) DO UPDATE SET source = 'provider', local_path = excluded.local_path, remote_url = excluded.remote_url
      WHERE artwork.source = 'provider'`).run(gameId, kind, localPath, remoteUrl);
    return result.changes === 1;
  }

  replaceWithProviderArtwork(gameId: number, kind: 'cover' | 'background', localPath: string, remoteUrl: string): boolean {
    if (!Number.isSafeInteger(gameId) || gameId <= 0 || !['cover', 'background'].includes(kind) ||
      !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(localPath) || !/^https:\/\//.test(remoteUrl)) throw new Error('Invalid artwork.');
    const result = this.db.prepare(`INSERT INTO artwork (game_id, kind, source, local_path, remote_url) VALUES (?, ?, 'provider', ?, ?)
      ON CONFLICT(game_id, kind) DO UPDATE SET source = 'provider', local_path = excluded.local_path, remote_url = excluded.remote_url`).run(gameId, kind, localPath, remoteUrl);
    return result.changes === 1;
  }

  saveManualOverrides(gameId: number, overrides: Record<string, unknown>): boolean {
    if (!Number.isSafeInteger(gameId) || gameId <= 0 || !validOverrides(overrides)) throw new Error('Invalid overrides.');
    return this.db.prepare('UPDATE games SET manual_overrides = ? WHERE id = ?').run(JSON.stringify(overrides), gameId).changes === 1;
  }
  saveManualArtwork(gameId: number, kind: 'cover' | 'background', localPath: string): boolean {
    if (!Number.isSafeInteger(gameId) || gameId <= 0 || !['cover', 'background'].includes(kind) || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(localPath)) throw new Error('Invalid artwork.');
    return this.db.prepare(`INSERT INTO artwork (game_id, kind, source, local_path, remote_url) VALUES (?, ?, 'manual', ?, NULL)
      ON CONFLICT(game_id, kind) DO UPDATE SET source = 'manual', local_path = excluded.local_path, remote_url = NULL`).run(gameId, kind, localPath).changes === 1;
  }
  clearManualWork(gameId: number): boolean {
    return this.db.transaction(() => { const result = this.db.prepare("UPDATE games SET manual_overrides = '{}' WHERE id = ?").run(gameId); this.db.prepare("DELETE FROM artwork WHERE game_id = ? AND source = 'manual'").run(gameId); return result.changes === 1; })();
  }
  clearMetadata(gameId: number): boolean {
    if (!Number.isSafeInteger(gameId) || gameId <= 0) throw new Error('Invalid game ID.');
    return this.db.transaction(() => {
      const result = this.db.prepare(`UPDATE games SET match_status = 'unmatched', binding_source = NULL,
        provider_id = NULL, provider_record_id = NULL, confidence = NULL, provider_metadata = '{}', manual_overrides = '{}' WHERE id = ?`).run(gameId);
      this.db.prepare("DELETE FROM artwork WHERE game_id = ? AND source = 'provider'").run(gameId);
      return result.changes === 1;
    })();
  }
  refreshBoundMatch(gameId: number, providerId: string, recordId: string, details: GameDetails): boolean {
    if (!Number.isSafeInteger(gameId) || gameId <= 0 || details.recordId !== recordId) throw new Error('Invalid match refresh.');
    return this.db.prepare('UPDATE games SET provider_metadata = ? WHERE id = ? AND provider_id = ? AND provider_record_id = ?').run(JSON.stringify(displayMetadata({ ...details })), gameId, providerId, recordId).changes === 1;
  }
  deleteMissing(): number {
    return this.db.prepare('DELETE FROM games WHERE missing = 1').run().changes + this.db.prepare('DELETE FROM collections WHERE missing = 1').run().changes;
  }

  reconcile(scan: ScanResult, observedAt = new Date().toISOString()): 'applied' | 'skipped' {
    if (scan.status === 'failed') return 'skipped';
    if (scan.status !== 'complete') throw new Error('Incomplete scan result.');
    validateDiscoveries(scan);
    if (!Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt) {
      throw new Error('Invalid scan timestamp.');
    }

    this.db.transaction(() => {
      this.db.exec('UPDATE games SET missing = 1; UPDATE collections SET missing = 1;');
      const collectionUpsert = this.db.prepare(`INSERT INTO collections
        (path_key, relative_path, folder_name, display_name, added_at, last_seen_at)
        VALUES (@key, @path, @folderName, @displayName, @time, @time)
        ON CONFLICT(path_key) DO UPDATE SET relative_path = excluded.relative_path,
        folder_name = excluded.folder_name, display_name = excluded.display_name,
        last_seen_at = excluded.last_seen_at, missing = 0 RETURNING id`);
      const collectionIds = new Map<string, number>();
      for (const collection of scan.collections) {
        const path = catalogPath(collection.relativePath);
        const row = collectionUpsert.get({ key: path.key, path: path.path, folderName: collection.folderName,
          displayName: collection.displayName, time: observedAt }) as { id: number };
        collectionIds.set(path.key, row.id);
      }
      const gameUpsert = this.db.prepare(`INSERT INTO games
        (path_key, relative_path, folder_name, collection_id, added_at, last_seen_at)
        VALUES (@key, @path, @folderName, @collectionId, @time, @time)
        ON CONFLICT(path_key) DO UPDATE SET relative_path = excluded.relative_path,
        folder_name = excluded.folder_name, collection_id = excluded.collection_id,
        last_seen_at = excluded.last_seen_at, missing = 0`);
      for (const game of scan.games) {
        const path = catalogPath(game.relativePath);
        gameUpsert.run({ key: path.key, path: path.path, folderName: game.folderName,
          collectionId: game.collectionPath === null ? null : collectionIds.get(catalogPath(game.collectionPath).key), time: observedAt });
      }
    })();
    return 'applied';
  }

  saveMatch(gameId: number, binding: ProviderBinding, details: GameDetails): boolean {
    if (!Number.isSafeInteger(gameId) || gameId <= 0 || !/^[a-z][a-z0-9-]*$/.test(binding.providerId) ||
      !binding.providerRecordId || binding.providerRecordId !== details.recordId || !details.title?.trim() ||
      !['manual', 'automatic'].includes(binding.source) ||
      (binding.source === 'automatic' && (binding.confidence === null || !Number.isFinite(binding.confidence) || binding.confidence < 0 || binding.confidence > 1))) {
      throw new Error('Invalid match.');
    }
    // Manual overrides and all filesystem identity/presence fields remain untouched.
    const result = this.db.prepare(`UPDATE games SET match_status = 'matched', binding_source = ?,
      provider_id = ?, provider_record_id = ?, confidence = ?, provider_metadata = ?
      WHERE id = ? AND (? = 'manual' OR (match_status = 'unmatched' AND provider_id IS NULL))`)
      .run(binding.source, binding.providerId, binding.providerRecordId, binding.source === 'manual' ? null : binding.confidence,
        JSON.stringify(displayMetadata({ ...details })), gameId, binding.source);
    return result.changes === 1;
  }

  close(): void { this.db.close(); }
}

function validOverrides(value: Record<string, unknown>): boolean {
  const allowed = new Set(['title', 'description', 'releaseYear', 'developers', 'publishers', 'genres', 'rating']);
  return value && typeof value === 'object' && Object.keys(value).every(key => allowed.has(key)) && Object.entries(value).every(([key, item]) => item === null ||
    (['title', 'description'].includes(key) ? typeof item === 'string' && item.length <= 10_000 : key === 'releaseYear' ? Number.isInteger(item) && (item as number) > 0 && (item as number) < 10_000 : key === 'rating' ? typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 100 : Array.isArray(item) && item.length <= 50 && item.every(name => typeof name === 'string' && name.length <= 200)));
}
