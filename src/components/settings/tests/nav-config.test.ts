import { describe, expect, it } from "vitest";

import {
  SETTINGS_NAV_ITEMS,
  pathnameToSettingsSection,
} from "../nav-config";

describe("settings nav pathname resolution", () => {
  it.each(SETTINGS_NAV_ITEMS)("resolves $href to $id", (item) => {
    expect(pathnameToSettingsSection(item.href)).toBe(item.id);
  });

  it("resolves the API Keys hyphenated route without falling back to Codex", () => {
    expect(pathnameToSettingsSection("/settings/api-keys")).toBe("apiKeys");
  });

  it("accepts trailing slashes and nested paths", () => {
    expect(pathnameToSettingsSection("/settings/api-keys/")).toBe("apiKeys");
    expect(pathnameToSettingsSection("/settings/api-keys/details")).toBe("apiKeys");
  });

  it("keeps the settings root and unknown routes on Codex", () => {
    expect(pathnameToSettingsSection("/settings")).toBe("codex");
    expect(pathnameToSettingsSection("/settings/unknown")).toBe("codex");
  });
});
