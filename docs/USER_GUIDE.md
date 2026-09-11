# GameShelf user guide

[Back to the project](../README.md)

GameShelf turns your local game folders into a browsable collection. You can use it without an account or internet connection; online services are optional extras for game details and artwork.

## 1. Get started

The MVP currently runs from the project folder on **Windows x64**. A ready-to-run portable download is still planned. This one-time setup is the only command-line step needed to try the current version.

1. Install [Node.js](https://nodejs.org/en/download), version 22.12 or newer.
2. Download this repository using **Code > Download ZIP** on GitHub and extract it, or clone it if you use Git.
3. Open a terminal in the extracted project folder, where `package.json` is located.
4. Run these commands. The first downloads dependencies and requires internet access; the second opens GameShelf.

   ```powershell
   npm ci
   npm run dev
   ```

Keep the terminal open while using the app. Close the app window when finished. To open it again, run `npm run dev` from the same project folder. You do not need to repeat `npm ci` unless the project dependencies change.

## 2. Choose your library

Select **Choose library folder** in the sidebar and choose the folder that holds your games. Then select **Scan library**.

Keep the GameShelf project folder separate from the folder you scan. For a layout that can move together, put both on the same drive:

```text
My drive/
  GameShelf/            The app project and its saved catalog
  Games/                Select this as your library folder
    Game A/
    Game B.zip
    [C] Favorites/
      Game C/
      Game D.iso
    _Not on my shelf/
```

GameShelf recognizes:

- Folders directly inside your library as games, without looking inside them.
- Files ending in `.zip`, `.rar`, `.iso`, or `.exe` directly inside your library as individual entries. Their displayed names omit the extension.
- Folders beginning with `[C]` as collections. Their immediate game folders and supported files become collection members.
- Folders beginning with `_` as excluded. Other file types, shortcuts, and linked folders are skipped.

Collections are recognized only directly inside the library root. GameShelf does not search deeper inside game folders or open files to discover their contents. An empty game folder still counts as an entry.

Scans happen only when you select **Settings > Library > Scan library**. Opening GameShelf, choosing a folder, and selecting **Retry** do not scan. With providers enabled, matching begins after the local scan has saved your entries; progress appears in the sidebar.

## 3. Browse your shelf

| View               | Use it for                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**           | Browse collections and groups by release decade or genre. Recently added shows games discovered after your first scan; the initial scan and a rebuild start with no recently added items. |
| **All Games**      | Search titles, filter by year, genre, or collection, and sort by title or release date.                                                                                                   |
| **Collections**    | Open a collection and browse its members.                                                                                                                                                 |
| **Needs matching** | Select the sidebar count to find entries without a metadata match. A `!` on a game card also marks an unresolved entry.                                                                   |
| **Settings**       | Use the bottom-of-sidebar link to open General, Library, and Providers tabs.                                                                                                              |

Select a game card to see its details. Missing descriptions, dates, or artwork mean that information has not been added yet.

GameShelf always opens on **Home**. In **Settings > Library**, turn off **Show collection games in main library** if you prefer to browse those games through their collections. Title search can still find them. **General** contains the default sort, **Library** contains folder, scan, collection, and maintenance controls, and **Providers** contains matching and credential options. Select **Save settings** after changing preferences. Search terms and your current page are temporary.

If a later GameShelf version supports additional provider data, select **Settings > Library > Fetch missing metadata**. It checks each saved match using its existing enabled provider and fills only missing provider data, artwork, and IGDB screenshots. It does not rematch games, replace existing provider values, or overwrite manual text and pasted artwork. A provider failure leaves that game unchanged while the remaining matches continue.

### Open a game's folder

For a game stored as a file, select **Open Container Folder** to open its containing folder in Explorer.

The current details button labeled **Install** opens the folder for a folder entry, or the containing folder for an ISO. **For ZIP/RAR/EXE entries, use Open Container Folder instead:** Install opens the file through Windows, and an EXE can run. This is a known MVP issue; the intended action is folder browsing only.

## 4. Add game details and covers (optional)

You can leave every provider disabled and use the catalog with your own titles and images. To enable online matching, open **Settings > Providers** and configure a provider:

| Provider        | What it adds                                                | What to enter                                                                                                                                            |
| --------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IGDB**        | Game details and available artwork                          | A Twitch application's Client ID and Client Secret, obtained through the [IGDB account setup instructions](https://api-docs.igdb.com/#account-creation). |
| **TheGamesDB**  | An alternative source for details and available artwork     | Your TheGamesDB API key; see the [provider's API portal](https://api.thegamesdb.net/).                                                                   |
| **SteamGridDB** | Supplemental cover and background artwork for matched games | Your API key from [SteamGridDB preferences](https://www.steamgriddb.com/profile/preferences/api).                                                        |

1. Enter the credentials for the provider you want and check its enable box.
2. Make sure **Provider order** includes its name. The default is `igdb,thegamesdb,steamgriddb`; to use only IGDB, enter `igdb`.
3. Select **Save settings**.
4. Open **Settings > Library** and select **Scan library** to try matching unresolved entries, or use **Match automatically** for one game as described below.

Providers are tried in the listed order when they can supply the requested information. SteamGridDB supplies artwork only; enabling it alone does not match game descriptions. Changing the order does not replace existing matches.

Saved credentials are not displayed again. Blank credential fields preserve what you previously saved. To stop using a provider, uncheck it and save. Credentials are stored in the local `config.ini`, so keep that file and backups private.

Leave **Matching threshold** at its default initially. **Greedy match** accepts the first result even when it may be a poor match; leave it off if you prefer to review uncertain titles yourself.

## 5. Fix an unmatched or incorrect title

1. Open a game, then choose **Edit > Find metadata**. For an existing match, choose **Edit > Change match**.
2. For an unresolved game, try **Match automatically**, or edit **Search title** to the name you want to find.
3. Choose **Search provider**, then **Search candidates**.
4. Compare the titles, release years, platforms, and provider details. Select **Select** beside the correct result.

IGDB candidates and matched details show their release platforms. Automatic matching prefers a PC or Windows candidate when IGDB provides one; **Greedy match** continues to use the provider's original result order.

Searching does not change the game. Selecting a result saves the match after its details have been retrieved. If the request fails, your existing match stays in place. Normal scans preserve chosen matches and manual edits.

To write your own title or description, choose **Edit > Edit metadata & artwork**, change the fields, and select **Save manual metadata**.

## 6. Choose your artwork

Matching may download available covers and backgrounds automatically. Saved images remain available offline.

To use your own image, copy the **image itself** to the Windows clipboard, open **Edit > Edit metadata & artwork**, and select **Paste cover from clipboard** or **Paste background from clipboard**. Copying a file path or image URL is not the same as copying an image. Pasting saves the artwork immediately.

For a matched game, choose **Edit > Fetch artwork** to request provider images. Leave the SteamGridDB game ID blank for a title search, or enter a known ID. Select **Fetch artwork**, compare the current and proposed images, then select **Replace artwork** to save the proposed replacements. Close the dialog to leave current artwork unchanged. This explicit replacement can overwrite pasted images shown in the preview.

## 7. Rescan, back up, and maintain

After adding or moving games yourself, select **Scan library**. Newly discovered paths are added; paths no longer found are marked missing. Missing entries remain visible, and returning a game to the same path makes it present again on the next successful scan. A rename or move can appear as a new entry plus an old missing entry.

If your drive is disconnected, reconnect it and select **Retry**, then scan when ready. Saved descriptions and cached art can still be browsed while the game library is unavailable. A failed scan does not mark everything missing.

### Back up or move your catalog

Close GameShelf before copying its saved files. Back up **`config.ini` and the entire `data` folder** from the GameShelf project folder. These hold settings, matches, edits, and artwork; your actual games need their own backup.

When moving the app and games together, preserve their relative folder layout on the same drive. A library selected on another drive during development uses a fixed drive path and will need attention if that drive letter changes. A standalone portable build and clean-machine relocation checks are still pending.

### Choose the right maintenance action

Destructive maintenance actions ask for confirmation. These operations affect the catalog, not your game folders or archives.

| Action                                           | Effect                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Settings > Library > Scan library**            | Updates discoveries and missing status, preserving existing matches and manual work. Use this for routine changes.                                                    |
| **Settings > Library > Fetch missing metadata**  | Explicitly backfills fields and missing assets newly supported by GameShelf for existing matches. It preserves bindings, existing metadata, and manual work.          |
| **Edit > Clear all metadata**                    | Clears that game's provider match, metadata, manual text, and provider artwork associations. Keeps pasted artwork and returns the game to Needs Matching.             |
| **Replace all manual work** in the manual editor | Replaces that game's manual metadata and artwork using its current provider record. If retrieval fails, existing work is preserved.                                   |
| **Settings > Library > Remove missing records**  | Deletes all catalog records currently marked missing. This cannot be undone through the app.                                                                          |
| **Settings > Library > Rebuild catalog**         | Replaces the catalog from the selected library, losing matches, manual metadata, and artwork associations. Use this explicitly when switching to a different library. |
| **Settings > Library > Wipe library**            | Deletes catalog records, cached artwork, and logs. Keeps library selection, settings, and provider credentials.                                                       |

## Troubleshooting

| What you see                          | What to try                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty library                         | Check the chosen folder and select **Scan library**. Games nested inside an ordinary game folder are not discovered.                                          |
| Library unavailable                   | Reconnect the drive, confirm the folder still exists, and select **Retry**.                                                                                   |
| Catalog belongs to a previous library | Reconnect the original library, or back up the catalog and explicitly rebuild for the newly selected library.                                                 |
| No metadata matches                   | Check that a metadata provider is enabled, configured, and listed in Provider order. Try a simpler search title or a different provider.                      |
| Wrong match                           | Use **Edit > Change match** and select the correct candidate. Consider turning off Greedy match.                                                              |
| No artwork                            | Match the game first, then use **Fetch artwork**, or paste your own image. Providers may not have art for every title.                                        |
| Provider error                        | Check credentials and connectivity. If the service is limiting requests, wait before trying again. Local browsing remains available.                          |
| Invalid configuration                 | Close the app and restore a known-good `config.ini` backup, or correct the reported setting. See the [configuration reference](DEVELOPMENT.md#configuration). |

For a reproducible problem, use the repository's bug report template. Include the visible error and steps to reproduce, but omit credentials and private paths.
