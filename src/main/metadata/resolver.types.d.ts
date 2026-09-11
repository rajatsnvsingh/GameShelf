/** Compile-time outcomes produced by conservative metadata resolution. */
import type { GameDetails, ProviderBinding } from './provider.types';

export interface MatchAttempt {
  providerId: string;
  outcome:
    | 'disabled'
    | 'unconfigured'
    | 'no-results'
    | 'low-confidence'
    | 'ambiguous'
    | 'error'
    | 'not-found'
    | 'matched';
}

export type Resolution =
  | { status: 'preserved'; binding: ProviderBinding }
  | {
      status: 'matched';
      binding: ProviderBinding;
      details: GameDetails;
      attempts: MatchAttempt[];
    }
  | { status: 'unresolved'; attempts: MatchAttempt[] };
