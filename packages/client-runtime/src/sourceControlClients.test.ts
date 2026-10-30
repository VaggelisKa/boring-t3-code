import { SourceControlProviderKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { appSignInTargetForRemote, sourceControlClients } from "./sourceControlClients.ts";

const parse = (url: string) => {
  const parsed = sourceControlClients.parseChangeRequestUrl(url);
  if (parsed === null) return null;
  const { repositoryUrl: _repositoryUrl, ...link } = parsed.link;
  return link;
};
const kindOf = (url: string) => sourceControlClients.parseChangeRequestUrl(url)?.definition.kind;

describe("sourceControlClients.parseChangeRequestUrl", () => {
  it("reads a GitHub pull request, lower-casing the repository", () => {
    expect(parse("https://github.com/T3Tools/T3Code/pull/123")).toEqual({
      host: "github.com",
      repository: "t3tools/t3code",
      number: 123,
    });
  });

  it("reads a GitHub pull request on any host, so GitHub Enterprise works on its own name", () => {
    expect(parse("https://code.github.example.com/acme/web/pull/42")).toEqual({
      host: "code.github.example.com",
      repository: "acme/web",
      number: 42,
    });
    expect(kindOf("https://scm.example.test/acme/web/pull/42")).toBe("github");
    expect(
      sourceControlClients.changeRequestUrlFromReferenceAutolink(
        "https://code.github.example.com/acme/web/issues/42",
      ),
    ).toBe("https://code.github.example.com/acme/web/pull/42");
  });

  it("survives trailing segments, a trailing slash and a query string", () => {
    expect(parse("https://github.com/t3tools/t3code/pull/123/files?w=1")).toEqual({
      host: "github.com",
      repository: "t3tools/t3code",
      number: 123,
    });
    expect(parse("https://github.com/t3tools/t3code/pull/123/")).toEqual({
      host: "github.com",
      repository: "t3tools/t3code",
      number: 123,
    });
  });

  it("claims nothing it cannot be sure of", () => {
    for (const link of [
      "https://github.com/t3tools/t3code/issues/123",
      "https://git.cafe/pingdotgg/t3code/issues/23897",
      "https://git.cafe/pingdotgg/t3code/pull/abc",
      "https://git.cafe/pingdotgg/t3code",
      "https://github.com/t3tools/t3code/commit/0a1b2c3",
      "https://github.com/t3tools/t3code",
      "https://github.com/t3tools/t3code/pull/abc",
      "https://gitlab.com/t3tools/t3code/-/issues/12",
      "https://blog.example.test/2026/updates/archive/pull/3",
      "https://scm.example.test/tfs/Collection/Project/_git/Repo",
      "https://scm.example.test/tfs/Collection/Project/pullrequest/123",
      "https://scm.example.test/tfs/Collection/Project/_git/Repo/pullrequest/abc",
      "https://scm.example.test/tfs/Collection/Project/_git/Repo/pullrequest/0",
      "https://scm.example.test/tfs/Collection/Project/_git/Repo/pullrequest/9007199254740992",
      "ftp://scm.example.test/tfs/Collection/Project/_git/Repo/pullrequest/123",
      "javascript:alert(1)//github.com/t3tools/t3code/pull/1",
      "not a url",
    ]) {
      expect(parse(link), link).toBeNull();
    }
  });
});

describe("sourceControlClients.isSameChangeRequest", () => {
  const linked = "https://github.com/pingdotgg/t3code/pull/42";

  it("matches the same pull request whatever its case or trailing path", () => {
    expect(
      sourceControlClients.isSameChangeRequest(
        linked,
        "https://github.com/PingDotGG/T3Code/pull/42/files",
      ),
    ).toBe(true);
  });

  it("keeps Forgejo and GitHub path shapes distinct on a GitHub-named host", () => {
    expect(
      sourceControlClients.isSameChangeRequest(
        "https://github.internal/team/repo/pulls/42",
        "https://github.internal/team/repo/pull/42",
      ),
    ).toBe(false);
  });
});

describe("change request URLs built from a parsed link", () => {
  const sibling = (url: string, number: number) => {
    const parsed = sourceControlClients.parseChangeRequestUrl(url)!;
    return parsed.definition.changeRequestUrl({
      host: parsed.link.host,
      repository: parsed.link.repository,
      number,
      webUrl: parsed.link.repositoryUrl,
    });
  };

  it.each([["https://github.com/pull/1/pull/42/files", "https://github.com/pull/1/pull/43"]])(
    "builds a canonical sibling of %s",
    (url, expected) => {
      expect(sibling(url, 43)).toBe(expected);
    },
  );
});

describe("sourceControlClients.recognizeRemote", () => {
  it("reads a remote no host claims as an unknown host, and a local path as no host", () => {
    expect(
      sourceControlClients.recognizeRemote("https://self-hosted.example.test:8443/group/repo.git"),
    ).toEqual({
      kind: "unknown",
      name: "self-hosted.example.test:8443",
      baseUrl: "https://self-hosted.example.test:8443",
    });
    expect(sourceControlClients.recognizeRemote("git@github-work:owner/repo.git")).toEqual({
      kind: "unknown",
      name: "github-work",
      baseUrl: "https://github-work",
    });
    for (const local of ["/srv/git/repo.git", "C:/repos/project", "file:///srv/git/repo.git", ""]) {
      expect(sourceControlClients.recognizeRemote(local), local).toBeNull();
    }
  });
});

describe("sourceControlClients repository keys", () => {
  // Persisted as `repositoryIdentity.canonicalKey` and in thread pull request keys.
  it.each([
    ["git@github.com:T3Tools/T3Code.git", "github.com/t3tools/t3code"],
    ["ssh://git@gitlab.company.com:2222/team/project.git", "gitlab.company.com/team/project"],
    [
      "https://T3Tools.visualstudio.com/DefaultCollection/Platform/_git/T3Code",
      "t3tools.visualstudio.com/defaultcollection/platform/_git/t3code",
    ],
    ["git@ssh.dev.azure.com:v3/o/p", "ssh.dev.azure.com/v3/o/p"],
    ["ssh.dev.azure.com/v3/o/p/r", "ssh.dev.azure.com/v3/o/p/r"],
    ["C:/repos/project", "c:/repos/project"],
  ])("keys %s as %s", (remote, key) => {
    expect(sourceControlClients.repositoryKeyFromRemote(remote)).toBe(key);
  });
});

describe("sourceControlClients project hosts", () => {
  it("selects a repository by its path except where the host's tools take a name", () => {
    const repository = {
      displayName: "group/subgroup/service",
      owner: "group",
      name: "service",
    };
    expect(sourceControlClients.repositorySelector(repository)).toBe("group/subgroup/service");
    expect(
      sourceControlClients.repositorySelector({
        ...repository,
        provider: SourceControlProviderKind.make("gitlab"),
      }),
    ).toBe("group/subgroup/service");
    expect(sourceControlClients.repositorySelector({ owner: "o", name: "r" })).toBe("o/r");
  });
});

describe("sourceControlClients.findByPublicDomain", () => {
  it("names the host a link is on, subdomains included", () => {
    const kindOf = (hostname: string) => sourceControlClients.findByPublicDomain(hostname)?.kind;
    expect(kindOf("gist.github.com")).toBe("github");
    expect(kindOf("notgithub.com")).toBeUndefined();
    expect(kindOf("github.com.example")).toBeUndefined();
  });

  it("leaves findByPublicHost to the public host alone", () => {
    expect(sourceControlClients.findByPublicHost("gist.github.com")).toBeUndefined();
  });
});

describe("appSignInTargetForRemote", () => {
  it("names the repository a GitHub remote points at, in the remote's casing", () => {
    for (const remote of [
      "https://github.com/octocat/Hello-World.git",
      "git@github.com:octocat/Hello-World.git",
    ]) {
      expect(appSignInTargetForRemote(remote)?.input).toEqual({
        provider: "github",
        host: "github.com",
        repository: "octocat/Hello-World",
      });
    }
  });

  it("skips hosts the app is not registered on", () => {
    expect(appSignInTargetForRemote("https://ghe.acme.test/acme/web.git")).toBeNull();
    expect(appSignInTargetForRemote("https://gitlab.com/acme/web.git")).toBeNull();
  });
});
