import type { Locale } from '@/i18n';

import { hasLandingBeenSeen, hasSeededWelcome, markWelcomeSeeded } from './gate';
import { WELCOME_NOTE } from './welcomeNote';

export interface SeedDeps {
  /** Injected rather than imported, so this is testable without Dexie. */
  listActive: () => Promise<readonly unknown[]>;
  create: (text: string) => Promise<unknown>;
  locale: Locale;
}

/**
 * Creates the welcome note, if this device should have one.
 *
 * The emptiness check is what stops a second device receiving a duplicate:
 * by the time this runs for a signed-in user, sync has settled and the
 * account's notes have arrived, so the count is non-zero and nothing is
 * added. See the spec's seed table.
 *
 * The checks are ordered cheapest-first on purpose. `listActive()` reads
 * every active note, which for a large account is real work; a device that
 * has already seeded, or has not yet made a landing choice, must not pay for
 * it. In practice this runs at most once per device ever.
 *
 * The seeded flag is written only after `create` RESOLVES. Marking first
 * would let a failed write (a quota error, a closed database) permanently
 * consume the device's one chance to seed.
 *
 * @returns whether a note was actually created.
 */
export async function seedWelcomeNote({ listActive, create, locale }: SeedDeps): Promise<boolean> {
  if (!hasLandingBeenSeen()) return false;
  if (hasSeededWelcome()) return false;

  const existing = await listActive();
  if (existing.length > 0) {
    // This device is settled and already has notes, so it will never want a
    // welcome note again — record that, rather than re-reading every active
    // note on every boot forever. Without the mark, a device that is later
    // emptied (everything trashed and purged) seeds a welcome note on its
    // next boot and syncs it up: the exact "delete it and it comes back"
    // the flag exists to prevent.
    //
    // This is safe ONLY because `WelcomeSeeder`'s `settled` gate means this
    // function is never reached in an unsettled state — see its docblock. If
    // that gate ever let `loading` or `unavailable` through again, this line
    // would permanently mark a device seeded on the strength of a note count
    // read before the account's notes had arrived.
    markWelcomeSeeded();
    return false;
  }

  try {
    await create(WELCOME_NOTE[locale]);
  } catch {
    // Leave the flag unset so a later boot can try again. A visitor with no
    // welcome note is a smaller failure than one who can never get it.
    return false;
  }

  markWelcomeSeeded();
  return true;
}
