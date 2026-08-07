/// <reference types="vite/client" />
/// <reference types="@testing-library/jest-dom/vitest" />

// `fake-indexeddb`'s "./auto" export condition has no "types" entry, so its
// sibling `auto.d.ts` cannot be resolved under the package's `exports` map
// (moduleResolution "bundler" requires an explicit "types" condition). This
// is a side-effect-only import — it installs globals and has no exports we
// consume — so an ambient declaration is the correct fix, not a type hole.
declare module 'fake-indexeddb/auto';
