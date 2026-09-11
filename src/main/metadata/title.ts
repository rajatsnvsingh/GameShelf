const archiveExtension = /\.(?:zip|rar|iso|exe)$/i;

/** Keeps catalog names literal while giving metadata providers the title implied by a supported archive filename. */
export function metadataTitle(name: string): string {
  return name.replace(archiveExtension, '');
}
