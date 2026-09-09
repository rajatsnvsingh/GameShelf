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
