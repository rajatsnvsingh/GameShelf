import { win32 as path } from 'node:path';

export function portableBase(packaged: boolean, appPath: string, portableDirectory?: string): string {
  const base = packaged ? portableDirectory : appPath;
  if (!base || !/^[a-z]:[\\/]/i.test(base)) {
    throw new Error('A local portable directory could not be determined.');
  }
  return path.normalize(base);
}

export function within(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..\\'));
}

export function validateRootLayout(base: string, root: string, data = path.join(base, 'data'), allowCrossDrive = false): void {
  if (!/^[a-z]:[\\/]/i.test(root) || (!allowCrossDrive && path.parse(base).root.toLowerCase() !== path.parse(root).root.toLowerCase())) {
    throw new Error('Choose a library on the same local drive as GameShelf.');
  }
  if (within(root, base) || within(root, data) || within(data, root)) {
    throw new Error('Choose a folder separate from GameShelf’s application and data folders.');
  }
}

export function resolveRoot(base: string, storedRoot: string, allowCrossDrive = false): string {
  if (!storedRoot || /[\x00-\x1f]/.test(storedRoot) || /^[a-z]:[^\\/]/i.test(storedRoot) || (!allowCrossDrive && (path.isAbsolute(storedRoot) || /:/.test(storedRoot)))) {
    throw new Error('The library root must be a relative path.');
  }
  const root = path.resolve(base, storedRoot);
  validateRootLayout(base, root, path.join(base, 'data'), allowCrossDrive);
  return root;
}

export function relativeRoot(base: string, root: string, allowCrossDrive = false): string {
  validateRootLayout(base, root, path.join(base, 'data'), allowCrossDrive);
  const relative = path.relative(base, root);
  return (path.isAbsolute(relative) ? path.normalize(root) : relative).replaceAll('\\', '/');
}
