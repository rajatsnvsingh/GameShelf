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
