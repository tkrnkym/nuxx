/**
 * Whether the composer shows its formatting toolbar.
 *
 * Shown by default: the controls are the only place the editor's capabilities
 * are visible at all, and a reader who has never seen them cannot know that
 * `**bold**` and code blocks are available. Hiding them is then a choice the
 * reader makes and this remembers.
 *
 * `localStorage` rather than a relay event, for the same reason as the channel
 * flags: it is a view preference, and publishing it would tell the community
 * something about how someone types.
 */

const STORAGE_KEY = "nuxx-composer-toolbar.v1";

/** The default, and what an unreadable or absent preference falls back to. */
export const TOOLBAR_VISIBLE_BY_DEFAULT = true;

/** Parse a stored value; anything unrecognised means "use the default". */
export function parseToolbarPreference(raw: string | null): boolean {
  if (raw === "hidden") return false;
  if (raw === "shown") return true;
  return TOOLBAR_VISIBLE_BY_DEFAULT;
}

export function serializeToolbarPreference(visible: boolean): string {
  return visible ? "shown" : "hidden";
}

/**
 * Read the preference.
 *
 * Storage can throw — a browser with site data blocked, or a private window —
 * and the toolbar is not worth a blank screen, so a failure is the default.
 */
export function readToolbarPreference(): boolean {
  try {
    return parseToolbarPreference(localStorage.getItem(STORAGE_KEY));
  } catch {
    return TOOLBAR_VISIBLE_BY_DEFAULT;
  }
}

export function writeToolbarPreference(visible: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeToolbarPreference(visible));
  } catch {
    // A preference that cannot be stored is still honoured for this session.
  }
}
