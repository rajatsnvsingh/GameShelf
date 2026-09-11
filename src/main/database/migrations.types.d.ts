/** Compile-time migration step description used by the catalog schema runner. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}
