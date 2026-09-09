// Keep validation independent of Electron so rejection cases need no GUI.
export function validateNoArgumentRequest(trustedMainFrame: boolean, args: unknown[]): void {
  if (!trustedMainFrame) throw new Error('Untrusted IPC sender');
  if (args.length !== 0) throw new Error('This request accepts no arguments');
}

export function validateGameIdRequest(trustedMainFrame: boolean, args: unknown[]): number {
  if (!trustedMainFrame) throw new Error('Untrusted IPC sender');
  const id = args[0];
  if (args.length !== 1 || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new Error('A positive game ID is required');
  return id;
}

export function validateSearchRequest(trusted: boolean, args: unknown[]): [number, string] {
  if (args.length !== 2) throw new Error('Expected game ID and query');
  const id = validateGameIdRequest(trusted, [args[0]]);
  const query = args[1];
  if (typeof query !== 'string' || !query.trim() || query.length > 250 || /[\x00-\x1f]/.test(query)) throw new Error('Invalid query');
  return [id, query];
}

export function validateSelectionRequest(trusted: boolean, args: unknown[]): [number, string, string] {
  if (args.length !== 3) throw new Error('Expected game ID, provider, and record ID');
  const id = validateGameIdRequest(trusted, [args[0]]);
  const [provider, record] = args.slice(1);
  if (typeof provider !== 'string' || !/^[a-z][a-z0-9-]{0,49}$/.test(provider) ||
    typeof record !== 'string' || !record.trim() || record.length > 100 || /[\x00-\x1f]/.test(record)) throw new Error('Invalid candidate ID');
  return [id, provider, record];
}
