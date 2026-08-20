import "@testing-library/jest-dom/vitest";
import * as fc from "fast-check";
import { afterAll } from "vitest";
import {
  destroyLiveViews,
  installViewTeardownNet,
} from "./teardown-safety";

// DETERMINISTIC PROPERTY RUNS. fast-check defaults
// to a random seed per run, which makes
// sampling-based assertions — the anti-vacuity
// checks that count how many generated cases reach
// a shape — flaky at the margin, and makes any
// counterexample hard to reproduce later. A fixed
// seed keeps CI honest AND repeatable; raise the run
// counts (or pass an explicit seed) when hunting for
// new counterexamples.
fc.configureGlobal({ seed: 20260818 });

// TEARDOWN SAFETY: no ProseMirror view may outlive
// its test FILE, or its deferred DOMObserver flush
// lands after happy-dom is gone and flips the
// process exit code with every test green. See
// test/teardown-safety.ts for the full trace.
installViewTeardownNet();
afterAll(() => {
  const leaked = destroyLiveViews();
  if (leaked > 0) {
    // SIGNAL WITHOUT A GATE: leaked editors are a
    // hygiene problem (they stay live for the rest of
    // their file, where they can still see events),
    // but failing on them would red the build over
    // pre-existing debt in four files — 62 views
    // today. A warning names the file in vitest's
    // output, so the count can only go down by
    // someone noticing.
    console.warn(
      `teardown net: destroyed ${leaked} leaked ` +
        "editor view(s) left alive by this file"
    );
  }
});
