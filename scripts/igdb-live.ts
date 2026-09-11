import { fileURLToPath } from 'node:url';
import { ConfigService } from '../src/main/config/service.ts';
import { configuredProviders } from '../src/main/metadata/service.ts';
import { IgdbError } from '../src/main/metadata/igdb.ts';

// Explicit opt-in only: never included in npm test or GUI smoke tests.
async function main(): Promise<void> {
  if (!process.argv.includes('--run')) {
    console.log(
      'SKIP: to contact IGDB, configure config.ini and run npm run test:igdb:live -- --run.'
    );
    return;
  }
  const base = fileURLToPath(new URL('../', import.meta.url));
  const { providers } = await configuredProviders(new ConfigService(base));
  const entry = providers.find((item) => item.provider.id === 'igdb');
  if (!entry?.enabled || !entry.configured) {
    console.log(
      'SKIP: add igdb to metadata.providerOrder and enable provider.igdb with clientId/clientSecret in config.ini.'
    );
    return;
  }
  const candidates = await entry.provider.search('Portal');
  const chosen = candidates.find((item) => item.title === 'Portal');
  if (!chosen) throw new IgdbError('live-search-no-exact-result');
  const details = await entry.provider.getGame(chosen.recordId);
  if (
    !details ||
    details.recordId !== chosen.recordId ||
    details.title !== chosen.title
  )
    throw new IgdbError('live-detail-mismatch');
  console.log(
    'PASS: IGDB authentication, search, and normalized details. No catalog or artwork files were changed.'
  );
}
main().catch((error) => {
  console.error(
    error instanceof IgdbError
      ? error.message
      : 'Live check failed. Check local configuration and connectivity.'
  );
  process.exitCode = 1;
});
