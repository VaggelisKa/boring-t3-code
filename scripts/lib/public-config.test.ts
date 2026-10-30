// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadRepoEnv } from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("applies process, root local, and root precedence in that order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "T3CODE_APPLE_TEAM_ID=root\nT3CODE_MACOS_PROVISIONING_PROFILE=root.provisionprofile\n",
    );
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".env.local"), "T3CODE_APPLE_TEAM_ID=local\n");

    expect(loadRepoEnv({ baseEnv: {}, repoRoot })).toMatchObject({
      T3CODE_APPLE_TEAM_ID: "local",
      T3CODE_MACOS_PROVISIONING_PROFILE: "root.provisionprofile",
    });
    expect(
      loadRepoEnv({ baseEnv: { T3CODE_APPLE_TEAM_ID: "ci" }, repoRoot }).T3CODE_APPLE_TEAM_ID,
    ).toBe("ci");
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
