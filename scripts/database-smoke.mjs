import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = await mkdtemp(join(tmpdir(), 'gameshelf-native-database-'));
await mkdir(join(base, 'Games'));
await cp('out', join(base, 'out'), { recursive: true });
await writeFile(join(base, 'package.json'), await readFile('package.json'));
for (const dependency of ['better-sqlite3', 'node-addon-api']) {
  await cp(
    join('node_modules', dependency),
    join(base, 'node_modules', dependency),
    { recursive: true }
  );
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
try {
  const application = await electron.launch({ args: [base], env });
  try {
    await application.firstWindow();
    const result = await application.evaluate(
      (_electron, { entry, base }) => {
        const require = process.getBuiltinModule('module').createRequire(entry);
        const { openCatalog } = require(entry);
        const scan = {
          status: 'complete',
          collections: [
            {
              folderName: 'Collection_Test',
              displayName: 'Test',
              relativePath: 'Collection_Test',
            },
          ],
          games: [
            {
              folderName: '日本語 Game',
              relativePath: 'Collection_Test/日本語 Game',
              collectionPath: 'Collection_Test',
            },
          ],
        };
        const repo = openCatalog(base, 'Games');
        let initial;
        let afterFailure;
        try {
          repo.reconcile(scan, '2026-09-09T10:00:00.000Z');
          initial = repo.listGames();
          repo.reconcile({
            status: 'failed',
            error: { code: 'listing-failed', relativePath: 'Collection_Test' },
          });
          afterFailure = repo.listGames();
        } finally {
          repo.close();
        }
        const reopened = openCatalog(base, 'Games');
        try {
          return {
            initial,
            afterFailure,
            reopened: reopened.listGames(),
            collections: reopened.listCollections(),
          };
        } finally {
          reopened.close();
        }
      },
      { entry: join(base, 'out/main/catalog.js'), base }
    );
    assert.equal(result.initial.length, 1);
    assert.equal(result.initial[0].relativePath, 'Collection_Test/日本語 Game');
    assert.equal(result.initial[0].collectionId, result.collections[0].id);
    assert.deepEqual(result.afterFailure, result.initial);
    assert.deepEqual(result.reopened, result.initial);
    console.log(
      'PASS: compiled repository and SQLite native binary in Electron; migrations, reconciliation, failed-scan preservation, and reopen.'
    );
  } finally {
    await application.close();
  }
} finally {
  await rm(base, { recursive: true, force: true });
}
