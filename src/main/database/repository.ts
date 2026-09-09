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
