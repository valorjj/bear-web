import { storedImageIds } from '@/data';

/**
 * The image a note-list row shows beside its preview: the first STORED image
 * in the note's Markdown, by id.
 *
 * **This used to return the first REMOTE image URL, and that was a privacy
 * hole.** When the row was redesigned, stored images did not exist and a
 * remote URL was the only image a note could name — so the row rendered
 * `<img src="https://someone-elses-host/x.png">`. Opening the app therefore
 * made a third-party request for every note referencing one, which is exactly
 * the beacon behaviour K1 refuses in the editor. The contradiction was found
 * by an e2e test that routed `example.com` and watched the request happen
 * while the editor correctly made none.
 *
 * A remote URL now yields NO thumbnail. The row shows the note's words
 * instead, which is a smaller loss than silently telling a third party which
 * of your notes you just opened. It also closes the recorded inconsistency
 * from sub-project I — the list no longer shows a picture the editor renders
 * as text, because now it only shows pictures the editor renders too.
 */
export function firstStoredImageId(text: string): string | null {
  return storedImageIds(text)[0] ?? null;
}
