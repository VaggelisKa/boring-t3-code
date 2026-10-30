import { expect, it } from "@effect/vitest";

import { resolveHeadlessConnectionString } from "./startupAccess.ts";

it("points wildcard and missing hosts at this machine's loopback", () => {
  expect(resolveHeadlessConnectionString("0.0.0.0", 3773)).toBe("http://localhost:3773");
  expect(resolveHeadlessConnectionString(undefined, 3773)).toBe("http://localhost:3773");
  expect(resolveHeadlessConnectionString("[::1]", 3773)).toBe("http://[::1]:3773");
});
