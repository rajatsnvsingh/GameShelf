/** Selects conservative metadata matches without writing catalog state. */
import type {
  GameDetails,
  ProviderBinding,
  ProviderEntry,
  SearchCandidate,
} from './provider.ts';

export type { MatchAttempt, Resolution } from './resolver.types';
import type { MatchAttempt, Resolution } from './resolver.types';
function normalize(title: string): string {
  return title.normalize('NFC').toLowerCase().trim().replace(/\s+/gu, ' ');
}

/** A conservative title heuristic, not a probability. No edition/sequel cleanup. */
export function titleConfidence(query: string, title: string): number {
  const left = normalize(query);
  const right = normalize(title);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const a = new Set(left.split(' '));
  const b = new Set(right.split(' '));
  const overlap = [...a].filter((word) => b.has(word)).length;

  return Math.min(0.89, (2 * overlap) / (a.size + b.size));
}

function validCandidate(candidate: SearchCandidate): boolean {
  return (
    typeof candidate?.recordId === 'string' &&
    Boolean(candidate.recordId.trim()) &&
    typeof candidate.title === 'string' &&
    Boolean(candidate.title.trim()) &&
    (candidate.platforms === undefined ||
      (Array.isArray(candidate.platforms) &&
        candidate.platforms.length <= 50 &&
        candidate.platforms.every(
          (platform) =>
            typeof platform === 'string' &&
            Boolean(platform.trim()) &&
            platform.length <= 200
        )))
  );
}

/** Identifies PC and Windows labels without treating unrelated PC platforms as Windows. */
function isWindowsCandidate(candidate: SearchCandidate): boolean {
  return Boolean(
    candidate.platforms?.some((platform) => {
      const normalized = platform.toLocaleLowerCase().trim();

      return normalized === 'pc' || normalized.includes('windows');
    })
  );
}

/** Returns a proposal only. Never writes the catalog, changes overrides, or refreshes a binding. */
export async function resolveMetadata(
  query: string,
  providers: readonly ProviderEntry[],
  options: {
    threshold?: number;
    greedyMatch?: boolean;
    binding?: ProviderBinding | null;
  } = {}
): Promise<Resolution> {
  // Normal scans and priority changes must not rematch any existing binding, even offline.
  if (options.binding)
    return { status: 'preserved', binding: { ...options.binding } };
  const threshold = options.threshold ?? 0.75;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error('Invalid matching threshold.');
  const attempts: MatchAttempt[] = [];
  if (!query.trim()) return { status: 'unresolved', attempts };
  const visited = new Set<string>();
  for (const { provider, enabled, configured } of providers) {
    if (visited.has(provider.id)) continue;
    visited.add(provider.id);
    // Artwork-only sources (SteamGridDB) must never supply a descriptive metadata binding.
    if (provider.capabilities.metadata === false) continue;
    const record = (outcome: MatchAttempt['outcome']) =>
      attempts.push({ providerId: provider.id, outcome });
    if (!enabled) {
      record('disabled');
      continue;
    }
    if (!configured) {
      record('unconfigured');
      continue;
    }
    try {
      const candidates = await provider.search(query);
      if (
        !Array.isArray(candidates) ||
        candidates.some((candidate) => !validCandidate(candidate))
      )
        throw new Error('Invalid search response.');
      // Duplicate IDs must not manufacture ambiguity or conceal inconsistent provider records.
      const unique = new Map<string, SearchCandidate>();
      for (const candidate of candidates) {
        const previous = unique.get(candidate.recordId);
        if (
          previous &&
          (previous.title !== candidate.title ||
            previous.releaseYear !== candidate.releaseYear)
        )
          throw new Error('Conflicting search records.');
        unique.set(candidate.recordId, candidate);
      }
      const scored = [...unique.values()].map((candidate) => ({
        candidate,
        score: titleConfidence(query, candidate.title),
        windows: isWindowsCandidate(candidate),
      }));
      const ranked = [...scored]
        // Prefer a Windows release before comparing title confidence; stable sorting then preserves provider rank.
        .sort(
          (a, b) => Number(b.windows) - Number(a.windows) || b.score - a.score
        );
      // Providers already rank their search results. Greedy mode deliberately trusts that order.
      const best = options.greedyMatch ? scored[0] : ranked[0];
      if (!best) {
        record('no-results');
        continue;
      }
      if (
        !options.greedyMatch &&
        (best.score === 0 || best.score < threshold)
      ) {
        record('low-confidence');
        continue;
      }
      // An exact normalized title follows provider ranking; approximate matches still require a clear lead.
      if (
        !options.greedyMatch &&
        best.score < 1 &&
        ranked[1] &&
        best.score - ranked[1].score < 0.1
      ) {
        record('ambiguous');
        continue;
      }
      const details = await provider.getGame(best.candidate.recordId);
      if (details === null) {
        record('not-found');
        continue;
      }
      if (
        !validCandidate(details) ||
        details.recordId !== best.candidate.recordId ||
        normalize(details.title) !== normalize(best.candidate.title) ||
        !Array.isArray(details.artwork)
      ) {
        throw new Error('Inconsistent detail response.');
      }
      record('matched');

      return {
        status: 'matched',
        binding: {
          providerId: provider.id,
          providerRecordId: details.recordId,
          source: 'automatic',
          confidence: best.score,
        },
        details,
        attempts,
      };
    } catch {
      // Never return raw provider exceptions, URLs, or credentials in diagnostics.
      record('error');
    }
  }

  return { status: 'unresolved', attempts };
}
