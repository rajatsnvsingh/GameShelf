import type { DisplayMetadata } from '../../shared/api.ts';

/** Explicit allowlist: no provider payloads, remote artwork URLs, or credentials in views. */
export function displayMetadata(provider: Record<string, unknown>, overrides: Record<string, unknown> = {}): DisplayMetadata {
  const fields = { ...provider, ...overrides };
  const result: DisplayMetadata = {};
  for (const key of ['title', 'description'] as const) {
    if (typeof fields[key] === 'string' && fields[key]) result[key] = fields[key];
  }
  for (const key of ['developers', 'publishers', 'genres'] as const) {
    const value = fields[key];
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) result[key] = [...value];
  }
  if (Number.isInteger(fields.releaseYear) && (fields.releaseYear as number) > 0) result.releaseYear = fields.releaseYear as number;
  if (typeof fields.rating === 'number' && Number.isFinite(fields.rating) && fields.rating >= 0 && fields.rating <= 100) result.rating = fields.rating;
  return result;
}
