// Wire up fake-indexeddb so code under test that touches `indexedDB` works
// inside jsdom. Imported once via vitest.config.ts `setupFiles`.

import "fake-indexeddb/auto";
