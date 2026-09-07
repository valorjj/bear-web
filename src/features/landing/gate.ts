/**
 * The landing gate's two durable markers.
 *
 * Both follow `useSession`'s pattern rather than reading `localStorage`
 * directly: the API throws outright in some private-window and
 * blocked-site-data contexts, and an unreadable marker must behave exactly
 * like an absent one. A visitor in a private window gets the landing screen,
 * which is the correct answer for a browser that has never chosen.
 */

/** Written once the visitor has completed a choice on the landing screen. */
export const LANDING_SEEN_KEY = 'bear-web:landing:seen';

/**
 * Written once this device has seeded its welcome note.
 *
 * Separate from `LANDING_SEEN_KEY` because the two answer different
 * questions, and the sign-in branch necessarily separates them in time: the
 * click navigates to Google and ends this JS context, so the seed happens on
 * the boot *after* the redirect. It also means deleting the welcome note and
 * reloading does not bring it back.
 */
export const LANDING_SEEDED_KEY = 'bear-web:landing:seeded';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Best effort, exactly as `useSession`'s markers are. A lost flag costs
    // one extra landing screen on the next boot, never a wrong state.
  }
}

export function hasLandingBeenSeen(): boolean {
  return readFlag(LANDING_SEEN_KEY);
}

export function markLandingSeen(): void {
  writeFlag(LANDING_SEEN_KEY);
}

export function hasSeededWelcome(): boolean {
  return readFlag(LANDING_SEEDED_KEY);
}

export function markWelcomeSeeded(): void {
  writeFlag(LANDING_SEEDED_KEY);
}
