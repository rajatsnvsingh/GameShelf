// Keep validation independent of Electron so rejection cases need no GUI.
export function validateNoArgumentRequest(trustedMainFrame: boolean, args: unknown[]): void {
  if (!trustedMainFrame) throw new Error('Untrusted IPC sender');
  if (args.length !== 0) throw new Error('This request accepts no arguments');
}
