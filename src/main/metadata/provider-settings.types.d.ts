/** Compile-time settings for metadata providers and their request runtimes. */
export interface IgdbSettings {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
}

export interface SteamGridDbSettings {
  enabled: boolean;
  apiKey: string;
}

export interface TheGamesDbSettings {
  enabled: boolean;
  apiKey: string;
}

export interface ProviderRuntime {
  fetch: typeof globalThis.fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  timeoutMs: number;
}
