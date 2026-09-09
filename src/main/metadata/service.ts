import type { ConfigService } from '../config/service.ts';
import { IgdbProvider } from './igdb.ts';
import type { ProviderEntry } from './provider.ts';

/** Construct once per explicit metadata session; shared instance retains token and rate bounds. */
export async function configuredProviders(config: ConfigService): Promise<{ providers: ProviderEntry[]; threshold: number }> {
  const settings = await config.getMetadataSettings();
  const providers: ProviderEntry[] = [];
  if (settings.providerOrder.includes('igdb')) {
    providers.push({ provider: new IgdbProvider(settings.igdb), enabled: settings.igdb.enabled,
      configured: Boolean(settings.igdb.clientId.trim() && settings.igdb.clientSecret.trim()) });
  }
  return { providers, threshold: settings.threshold };
}

/** Preserve the provider's token and rate state until INI metadata settings change. */
export function providerSession(config: ConfigService): typeof load {
  let key = '';
  let session: Awaited<ReturnType<typeof configuredProviders>> | undefined;
  async function load() {
    const next = JSON.stringify(await config.getMetadataSettings());
    if (!session || key !== next) { session = await configuredProviders(config); key = next; }
    return session;
  }
  return load;
}
