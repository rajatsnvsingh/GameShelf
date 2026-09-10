// Small, strict INI subset: sections, scalar keys, full-line comments, and JSON-quoted strings.
// Unknown scalar settings are retained for future provider sections, never returned to views.
export type Ini = Record<string, Record<string, string>>;

export function parseIni(text: string): Ini {
  const ini: Ini = Object.create(null);
  let section: Record<string, string> | undefined;
  for (const [index, raw] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || /^[;#]/.test(line)) continue;
    const header = /^\[([a-zA-Z][\w.-]*)\]$/.exec(line);
    if (header) {
      if (Object.hasOwn(ini, header[1])) throw new Error(`Duplicate INI section at line ${index + 1}.`);
      section = ini[header[1]] = Object.create(null);
      continue;
    }
    const entry = /^([a-zA-Z][\w.-]*)\s*=\s*(.*)$/.exec(line);
    if (!section || !entry || Object.hasOwn(section, entry[1])) {
      throw new Error(`Invalid INI entry at line ${index + 1}.`);
    }
    let value = entry[2].trim();
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { throw new Error(`Invalid quoted INI value at line ${index + 1}.`); }
      if (typeof value !== 'string') throw new Error(`Invalid INI value at line ${index + 1}.`);
    }
    section[entry[1]] = value;
  }
  return ini;
}

export function writeIni(ini: Ini): string {
  return Object.entries(ini).map(([name, entries]) =>
    `[${name}]\n${Object.entries(entries).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n')}\n`
  ).join('\n');
}

export function withDefaults(ini: Ini): Ini {
  const defaults: Ini = {
    app: { version: '1' },
    library: { root: '', collectionPrefix: '[C]', showCollectionGames: 'true' },
    metadata: { matchingThreshold: '0.90', providerOrder: 'igdb,thegamesdb,steamgriddb' },
    view: { defaultSort: 'title' }
  };
  for (const [name, entries] of Object.entries(defaults)) {
    ini[name] ??= Object.create(null);
    for (const [key, value] of Object.entries(entries)) ini[name][key] ??= value;
  }
  if (ini.app.version !== '1') throw new Error('Unsupported INI version.');
  if (!ini.library.collectionPrefix || /[<>:"/\\|?*\x00-\x1f]/.test(ini.library.collectionPrefix)) {
    throw new Error('Invalid collection prefix.');
  }
  if (!['true', 'false'].includes(ini.library.showCollectionGames)) throw new Error('Invalid collection visibility.');
  if (!/^(0(?:\.\d+)?|1(?:\.0+)?)$/.test(ini.metadata.matchingThreshold)) throw new Error('Invalid matching threshold.');
  if (!['title', 'releaseDate'].includes(ini.view.defaultSort)) throw new Error('Invalid default sort.');
  return ini;
}
