/** Compile-time result shape for the filesystem scanner adapter. */
import type { ListDirectory } from './scanner.types';

export interface ScanReader {
  listDirectory: ListDirectory;
  verifyUnchanged(): Promise<void>;
}
