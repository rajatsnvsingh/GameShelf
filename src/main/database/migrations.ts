import type Database from 'better-sqlite3';

export interface Migration { readonly version: number; readonly name: string; readonly sql: string; }

export const migrations: readonly Migration[] = [{
  version: 1,
  name: 'initial-catalog',
  sql: `
    CREATE TABLE catalog (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      library_root TEXT NOT NULL
    ) STRICT;
    CREATE TABLE collections (
      id INTEGER PRIMARY KEY,
      path_key TEXT NOT NULL UNIQUE,
      relative_path TEXT NOT NULL,
      folder_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      added_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      missing INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1))
    ) STRICT;
    CREATE TABLE games (
      id INTEGER PRIMARY KEY,
      path_key TEXT NOT NULL UNIQUE,
      relative_path TEXT NOT NULL,
      folder_name TEXT NOT NULL,
      collection_id INTEGER REFERENCES collections(id),
      added_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      missing INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1)),
      match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched', 'matched')),
      binding_source TEXT CHECK (binding_source IN ('automatic', 'manual')),
      provider_id TEXT,
      provider_record_id TEXT,
      confidence REAL CHECK (confidence BETWEEN 0 AND 1),
      provider_metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provider_metadata) AND json_type(provider_metadata) = 'object'),
      manual_overrides TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(manual_overrides) AND json_type(manual_overrides) = 'object')
    ) STRICT;
    CREATE INDEX games_collection_id ON games(collection_id);
  `
}, {
  version: 2,
  name: 'artwork-cache',
  sql: `
    CREATE TABLE artwork (
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('cover', 'background')),
      source TEXT NOT NULL CHECK (source IN ('provider', 'manual')),
      local_path TEXT NOT NULL,
      remote_url TEXT,
      PRIMARY KEY (game_id, kind)
    ) STRICT;
  `
}];

export function applyMigrations(db: Database.Database, steps: readonly Migration[] = migrations): void {
  if (steps.some((step, index) => step.version !== index + 1 || !step.name)) {
    throw new Error('Migrations must be ordered and consecutive.');
  }
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT`);
    const applied = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as { version: number; name: string }[];
    if (applied.some((row, index) => row.version !== index + 1 || steps[index]?.name !== row.name)) {
      throw new Error('Unsupported or inconsistent database migration history.');
    }
    const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
    for (const step of steps.slice(applied.length)) {
      db.exec(step.sql);
      record.run(step.version, step.name, new Date().toISOString());
    }
  })();
}
