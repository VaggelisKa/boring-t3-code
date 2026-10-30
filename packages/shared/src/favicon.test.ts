import { describe, expect, it } from "@effect/vitest";

import { toolActivityFaviconUrl } from "./favicon.ts";

describe("toolActivityFaviconUrl", () => {
  it("keeps inline images and drops remote ones", () => {
    const inline = "data:image/png;base64,AAAA";
    expect(
      toolActivityFaviconUrl({ pageUrl: "https://github.com", faviconUrl: inline }, "light"),
    ).toBe(inline);
    expect(
      toolActivityFaviconUrl(
        { pageUrl: "https://github.com", faviconUrl: "https://example.com/icon.png" },
        "light",
      ),
    ).toBeNull();
    expect(toolActivityFaviconUrl({ pageUrl: "https://github.com" }, "dark")).toBeNull();
  });
});
