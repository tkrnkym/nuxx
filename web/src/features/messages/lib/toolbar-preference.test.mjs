import assert from "node:assert/strict";
import test from "node:test";

import {
  parseToolbarPreference,
  serializeToolbarPreference,
  TOOLBAR_VISIBLE_BY_DEFAULT,
} from "./toolbar-preference.ts";

test("the toolbar is shown until someone hides it", () => {
  assert.equal(TOOLBAR_VISIBLE_BY_DEFAULT, true);
  assert.equal(parseToolbarPreference(null), true);
  assert.equal(parseToolbarPreference("nonsense"), true);
});

test("a stored choice round-trips", () => {
  for (const visible of [true, false]) {
    assert.equal(
      parseToolbarPreference(serializeToolbarPreference(visible)),
      visible,
    );
  }
});
