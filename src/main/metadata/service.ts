/** Builds configured provider sessions and exposes their ordered availability. */
import type { ConfigService } from '../config/service.ts';
import { IgdbProvider } from './igdb.ts';
import { TheGamesDbProvider } from './thegamesdb.ts';
import { SteamGridDbProvider } from './steamgriddb.ts';
import type { ProviderEntry } from './provider.ts';

/** Construct once per explicit metadata session; shared instance retains token and rate bounds. */
export async function configuredProviders(config: ConfigService): Promise<{
  providers: ProviderEntry[];
  threshold: number;
  greedyMatch: boolean;
}> {
  const settings = await config.getMetadataSettings();
  const providers: ProviderEntry[] = [];
  for (const id of new Set(settings.providerOrder)) {
    if (id === 'igdb')
      providers.push({
        provider: new IgdbProvider(settings.igdb),
        enabled: settings.igdb.enabled,
        configured: Boolean(
          settings.igdb.clientId.trim() && settings.igdb.clientSecret.trim()
        ),
      });
    if (id === 'thegamesdb')
      providers.push({
        provider: new TheGamesDbProvider(settings.thegamesdb),
        enabled: settings.thegamesdb.enabled,
        configured: Boolean(settings.thegamesdb.apiKey.trim()),
      });
    if (id === 'steamgriddb')
      providers.push({
        provider: new SteamGridDbProvider(settings.steamgriddb),
        enabled: settings.steamgriddb.enabled,
        configured: Boolean(settings.steamgriddb.apiKey.trim()),
      });
  }

  return {
    providers,
    threshold: settings.threshold,
    greedyMatch: settings.greedyMatch,
  };
}

/** Preserve the provider's token and rate state until INI metadata settings change. */
export function providerSession(config: ConfigService): typeof load {
  let key = '';
  let session: Awaited<ReturnType<typeof configuredProviders>> | undefined;
  async function load() {
    const next = JSON.stringify(await config.getMetadataSettings());
    if (!session || key !== next) {
      session = await configuredProviders(config);
      key = next;
    }

    return session;
  }

  return load;
}
