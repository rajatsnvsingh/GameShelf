import { fileURLToPath } from 'node:url';
import { ConfigService } from '../src/main/config/service.ts';
import { configuredProviders } from '../src/main/metadata/service.ts';
import { TheGamesDbError } from '../src/main/metadata/thegamesdb.ts';

async function main(): Promise<void> {
  if (!process.argv.includes('--run')) {
    console.log('SKIP: configure config.ini and run npm run test:thegamesdb:live -- --run to contact TheGamesDB.');
    return;
  }
  const { providers } = await configuredProviders(new ConfigService(fileURLToPath(new URL('../', import.meta.url))));
  const entry = providers.find(item => item.provider.id === 'thegamesdb');
  if (!entry?.enabled || !entry.configured) {
    console.log('SKIP: enable provider.thegamesdb with apiKey and add thegamesdb to metadata.providerOrder.');
    return;
  }
  const results = await entry.provider.search('Portal');
  const candidate = results.find(item => item.title === 'Portal');
  if (!candidate) throw new TheGamesDbError('live-search-no-exact-result');
  const details = await entry.provider.getGame(candidate.recordId);
  if (!details || details.recordId !== candidate.recordId || details.title !== candidate.title) throw new TheGamesDbError('live-detail-mismatch');
  console.log('PASS: TheGamesDB authenticated search, details, and name normalization. No catalog or artwork files changed.');
}
main().catch(error => {
  console.error(error instanceof TheGamesDbError ? error.message : 'Live check failed. Check local configuration and connectivity.');
  process.exitCode = 1;
});
