import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { type LimitAccount, collectProviderUsageLimits, collectLimitAccounts, collectExternalUsageLinks, collectLimitNotices, collectLimitPools, elapsedShare, exhaustedUsageWindow, paceOf, paceRemainingPercent, usesChatGptSharing, resolveNewThreadModelSelection } from "./usageLimits.ts";

const now = Date.parse("2026-09-03T12:00:00.000Z");

const window = {
  id: "five_hour",
  kind: "session",
  label: "Session",
  usedPercent: 40,
  windowDurationMins: 300,
  resetsAt: "2026-09-03T14:00:00.000Z",
} as const;

function provider(overrides: Partial<ServerProvider>): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-03T11:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("new thread model fallback", () => {
  const selection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };
  const fallback = { instanceId: ProviderInstanceId.make("claude"), model: "claude-fable-5-1" };
  const limited = provider({
    usageLimits: {
      checkedAt: "2026-09-03T11:00:00.000Z",
      windows: [{ ...window, usedPercent: 100 }],
    },
  });
  const available = provider({
    instanceId: fallback.instanceId,
    driver: ProviderDriverKind.make("claudeAgent"),
  });

  const defaults = {
    defaultSelection: selection,
    fallbackSelection: fallback,
    providers: [limited, available],
    now,
  };
  it.each([
    ["exhausted default", {}, fallback],
    ["explicit selection", { explicitSelection: selection }, selection],
    ["missing default", { defaultSelection: null }, null],
    ["no fallback", { fallbackSelection: null }, selection],
    ["expired window", { now: Date.parse("2026-09-04T00:00:00Z") }, selection],
    [
      "environment disabled",
      {
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          providerInstances: {
            [fallback.instanceId]: { driver: available.driver, enabled: false, config: {} },
          },
        },
      },
      selection,
    ],
  ] as const)("resolves %s", (_name, overrides, expected) => {
    expect(resolveNewThreadModelSelection({ ...defaults, ...overrides }).selection).toEqual(
      expected,
    );
  });
  it.each([
    { enabled: false },
    { installed: false },
    { auth: { status: "unauthenticated" as const } },
    { availability: "unavailable" as const },
    { usageLimits: limited.usageLimits },
  ])("rejects an unusable fallback: %j", (overrides) => {
    expect(
      resolveNewThreadModelSelection({
        ...defaults,
        providers: [limited, { ...available, ...overrides }],
      }).selection,
    ).toEqual(selection);
  });
  it.each([undefined, "invalid"])("treats an unknown reset as exhausted: %s", (resetsAt) => {
    expect(
      exhaustedUsageWindow(
        provider({
          usageLimits: {
            checkedAt: limited.checkedAt,
            windows: [{ ...window, usedPercent: 100, resetsAt }],
          },
        }),
        now,
      ),
    ).toBeDefined();
  });
  it.each([
    ["cursor", ["autoPercentUsed"], "claude-opus-5-5", false],
    ["cursor", ["autoPercentUsed"], "composer-2.5", false],
    ["cursor", ["autoPercentUsed", "apiPercentUsed"], "composer-2.5", true],
    ["antigravity", ["gemini-weekly"], "claude-opus-5-5", false],
    ["antigravity", ["3p-weekly"], "claude-opus-5-5", true],
    ["antigravity", ["gemini-weekly"], "antigravity-default", true],
    ["opencode", ["go_weekly"], "opencode/big-pickle", false],
    ["opencode", ["go_weekly"], "opencode-go/big-pickle", true],
  ] as const)("matches %s pools %s to %s", (driver, ids, model, usesFallback) => {
    const defaultSelection = { ...selection, model };
    expect(
      resolveNewThreadModelSelection({
        ...defaults,
        defaultSelection,
        providers: [
          provider({
            driver: ProviderDriverKind.make(driver),
            usageLimits: {
              checkedAt: limited.checkedAt,
              windows: ids.map((id) => ({ ...window, id, usedPercent: 100 })),
            },
          }),
          available,
        ],
      }).selection,
    ).toEqual(usesFallback ? fallback : defaultSelection);
  });
});

describe("pace", () => {
  it("places the clock three fifths through a five-hour window with two hours left", () => {
    expect(elapsedShare(window, now)).toBeCloseTo(0.6);
    expect(paceRemainingPercent(window, now)).toBe(40);
    expect(paceOf(window, now)).toBe("under");
    expect(paceOf({ ...window, usedPercent: 62 }, now)).toBe("on");
    expect(paceOf({ ...window, usedPercent: 80 }, now)).toBe("ahead");
  });
});

describe("pools", () => {
  const checkedAt = "2026-09-03T11:00:00.000Z";
  const laptop = { entry: { target: { label: "Laptop" } } };

  it("merges OpenCode Go limits from machines with the same API key", () => {
    const go = provider({
      driver: ProviderDriverKind.make("opencode"),
      instanceId: ProviderInstanceId.make("opencode"),
      auth: { status: "authenticated" },
      usageLimits: {
        checkedAt,
        credentialFingerprint: "shared-go-key",
        windows: [{ ...window, id: "go_rolling", usedPercent: 3 }],
      },
    });
    const input = new Map([
      [EnvironmentId.make("env-a"), { ...laptop, serverConfig: { providers: [go] } }],
      [
        EnvironmentId.make("env-b"),
        {
          entry: { target: { label: "Desktop" } },
          serverConfig: {
            providers: [
              {
                ...go,
                usageLimits: {
                  ...go.usageLimits!,
                  checkedAt: "2026-09-03T11:30:00.000Z",
                  windows: [{ ...window, id: "go_rolling", usedPercent: 4 }],
                },
              },
            ],
          },
        },
      ],
    ]);
    const accounts = collectLimitAccounts(input);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.environments).toEqual([
      { environmentId: "env-a", label: "Laptop" },
      { environmentId: "env-b", label: "Desktop" },
    ]);
    expect(collectLimitPools(accounts, now)[0]?.windows[0]?.members).toHaveLength(1);
    expect(accounts[0]?.limits.windows[0]?.usedPercent).toBe(4);

    const differentKey = {
      ...go,
      usageLimits: { ...go.usageLimits!, credentialFingerprint: "other-go-key" },
    };
    input.set(EnvironmentId.make("env-b"), {
      entry: { target: { label: "Desktop" } },
      serverConfig: { providers: [differentKey] },
    });
    expect(collectLimitAccounts(input)).toHaveLength(2);

    input.set(EnvironmentId.make("env-a"), {
      ...laptop,
      serverConfig: {
        providers: [{ ...go, auth: { status: "authenticated", email: "same@example.com" } }],
      },
    });
    input.set(EnvironmentId.make("env-b"), {
      entry: { target: { label: "Desktop" } },
      serverConfig: {
        providers: [
          { ...differentKey, auth: { status: "authenticated", email: "SAME@example.com" } },
        ],
      },
    });
    expect(collectLimitAccounts(input)).toHaveLength(1);
  });

  it("redeems on the environment whose snapshot supplied the credits on show", () => {
    const stale = provider({
      auth: { status: "authenticated", email: "same@example.com" },
      usageLimits: {
        checkedAt,
        windows: [window],
        resetCredits: { availableCount: 0 },
      },
    });
    const fresh = {
      ...stale,
      usageLimits: {
        checkedAt: "2026-09-03T11:30:00.000Z",
        windows: [window],
        resetCredits: { availableCount: 2 },
      },
    };
    const input = new Map([
      [EnvironmentId.make("env-a"), { ...laptop, serverConfig: { providers: [stale] } }],
      [
        EnvironmentId.make("env-b"),
        { entry: { target: { label: "Desktop" } }, serverConfig: { providers: [fresh] } },
      ],
    ]);
    const [account] = collectLimitAccounts(input);
    expect(account?.limits.resetCredits?.availableCount).toBe(2);
    expect(account?.redeem).toEqual({ environmentId: "env-b", input: { instanceId: "codex" } });
  });

  it("does not give old credits the timestamp of a newer window-only read", () => {
    const snapshots = [
      { checkedAt, windows: [window], resetCredits: { availableCount: 2 } },
      { checkedAt: "2026-09-03T12:00:00.000Z", windows: [window] },
      {
        checkedAt: "2026-09-03T11:30:00.000Z",
        windows: [window],
        resetCredits: { availableCount: 1 },
      },
    ];
    const input = new Map(
      snapshots.map((usageLimits, i) => [
        EnvironmentId.make(`env-${i}`),
        {
          ...laptop,
          serverConfig: {
            providers: [
              provider({
                auth: { status: "authenticated", email: "same@example.com" },
                usageLimits,
              }),
            ],
          },
        },
      ]),
    );
    const [account] = collectLimitAccounts(input);
    expect(account?.limits.checkedAt).toBe("2026-09-03T12:00:00.000Z");
    expect(account?.limits.resetCredits?.availableCount).toBe(1);
    expect(account?.redeem?.environmentId).toBe("env-2");
  });

});

describe("pooled account columns", () => {
  const weekly = {
    ...window,
    id: "seven_day",
    kind: "weekly",
    label: "Weekly",
    windowDurationMins: 7 * 24 * 60,
  } as const;
  const account = (key: string, windows: LimitAccount["limits"]["windows"]): LimitAccount => ({
    key,
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: key,
    email: undefined,
    plan: undefined,
    accentColor: undefined,
    environments: [],
    sourceLabel: "Hub",
    redeem: null,
    limits: { checkedAt: "2026-09-03T11:00:00.000Z", windows },
  });
  const keys = (pool: ReturnType<typeof collectLimitPools>[number]) =>
    pool.windows.map((row) =>
      row.columns.map((member) => (member.window ? member.account.key : null)),
    );

  // regression: #20349 sessions stay visible while the weekly quota is exhausted
  it.each([
    ["claudeAgent", "13:00", 40, "14:00", 100],
    ["codex", "14:00", 100, "14:00", 100],
    ["claudeAgent", "15:00", 100, "15:00", 100],
    ["codex", "15:00", 40, "14:00", 60],
  ] as const)(
    "%s session resetting at %s with %i percent spent becomes usable at %s with %i percent restored",
    (driver, sessionReset, usedPercent, usableAt, restoresPercent) => {
      const at = (time: string) => `2026-09-03T${time}:00.000Z`;
      const a = {
        ...account("a", [
          {
            ...window,
            id: driver === "codex" ? "primary" : window.id,
            usedPercent,
            resetsAt: at(sessionReset),
          },
          {
            ...weekly,
            id: driver === "codex" ? "secondary" : weekly.id,
            usedPercent: 100,
            resetsAt: at("14:00"),
          },
        ]),
        driver: ProviderDriverKind.make(driver),
      };
      const [session] = collectLimitPools([a], now)[0]!.windows;
      expect.soft(session?.remainingPercent).toBe(0);
      expect(session?.resets[0]).toMatchObject({
        at: Date.parse(at(usableAt)),
        restoresPercent,
      });
    },
  );

  it("excludes weekly-blocked sessions from the pool without changing snapshots or model allowances", () => {
    const blocked = account("blocked", [
      window,
      { ...weekly, usedPercent: 100 },
      { ...weekly, id: "seven_day_fable", usedPercent: 20 },
    ]);
    const accounts = [
      blocked,
      account("available", [
        { ...window, usedPercent: 20 },
        { ...weekly, usedPercent: 99 },
        { ...weekly, id: "seven_day_fable", usedPercent: 40 },
      ]),
      { ...blocked, key: "cursor", driver: ProviderDriverKind.make("cursor") },
    ];
    const snapshot = structuredClone(accounts);
    const [claude, cursor] = collectLimitPools(accounts, now);
    expect.soft(claude?.windows.map((row) => row.remainingPercent)).toEqual([40, 1, 70]);
    expect.soft(cursor?.windows.map((row) => row.remainingPercent)).toEqual([60, 0, 80]);
    expect(accounts).toEqual(snapshot);
  });

  it("keeps session columns across rows with opposite reset and usage orders", () => {
    const accounts = [
      account("a", [
        { ...weekly, usedPercent: 80, resetsAt: "2026-09-05T12:00:00.000Z" },
        { ...window, usedPercent: 10, resetsAt: "2026-09-03T15:00:00.000Z" },
      ]),
      account("b", [
        { ...weekly, usedPercent: 20, resetsAt: "2026-09-06T12:00:00.000Z" },
        { ...window, usedPercent: 90, resetsAt: "2026-09-03T13:00:00.000Z" },
      ]),
    ];
    const [pool] = collectLimitPools(accounts, now);
    expect(pool!.accounts.map((account) => account.key)).toEqual(["b", "a"]);
    expect(keys(pool!)).toEqual([
      ["b", "a"],
      ["b", "a"],
    ]);
    expect(pool!.windows[1]!.resets.map((reset) => reset.member.account.key)).toEqual(["a", "b"]);
    expect(pool!.windows[1]!.remainingPercent).toBe(50);
    expect(keys(collectLimitPools(accounts.toReversed(), now)[0]!)).toEqual(keys(pool!));
  });

  it.each([undefined, "invalid", "2026-09-03T11:30:00.000Z"])(
    "keeps blocked sessions empty without predicting a refill from a missing or stale clock (%s)",
    (resetsAt) => {
      const [pool] = collectLimitPools(
        [
          account("session-clock", [
            { ...window, resetsAt },
            { ...weekly, usedPercent: 100 },
          ]),
          account("weekly-clock", [window, { ...weekly, usedPercent: 100, resetsAt }]),
        ],
        now,
      );
      expect(pool!.windows[0]).toMatchObject({ remainingPercent: 0, pace: null, resets: [] });
      expect(pool!.windows[0]!.columns.map((column) => column.window?.resetsAt)).toEqual([
        undefined,
        undefined,
      ]);
    },
  );

  it("orders by usable session refill and clears suppression after a fresh weekly reading", () => {
    const blocked = account("blocked", [
      { ...window, resetsAt: "2026-09-03T13:00:00.000Z" },
      { ...weekly, usedPercent: 100, resetsAt: "2026-09-03T15:00:00.000Z" },
    ]);
    const available = account("available", [window]);
    const [before] = collectLimitPools([blocked, available], now);
    expect(before!.accounts.map((account) => account.key)).toEqual(["available", "blocked"]);
    expect(before!.windows[0]!.remainingPercent).toBe(30);
    const refreshed = {
      ...blocked,
      limits: {
        checkedAt: "2026-09-03T12:00:00.000Z",
        windows: [blocked.limits.windows[0]!, { ...weekly, usedPercent: 10 }],
      },
    };
    const [after] = collectLimitPools([refreshed, available], now);
    expect(after!.accounts.map((account) => account.key)).toEqual(["blocked", "available"]);
    expect(after!.windows[0]!.remainingPercent).toBe(60);
    expect(after!.windows[0]!.resets[0]).toMatchObject({
      at: Date.parse("2026-09-03T13:00:00.000Z"),
      restoresPercent: 20,
    });
  });

  it("preserves gaps without counting missing windows toward pooled quota", () => {
    const [pool] = collectLimitPools(
      [
        account("a", [window]),
        account("b", [
          { ...window, resetsAt: "2026-09-03T15:00:00.000Z" },
          { ...weekly, usedPercent: 80 },
        ]),
        account("c", [weekly]),
      ],
      now,
    );
    expect(keys(pool!)).toEqual([
      ["a", "b", null],
      [null, "b", "c"],
    ]);
    expect(pool!.windows[1]!.members.map((member) => member.account.key)).toEqual(["b", "c"]);
    expect(pool!.windows[1]!.remainingPercent).toBe(40);
    expect(pool!.windows[1]!.resets.map((reset) => reset.restoresPercent)).toEqual([40, 20]);
  });

  it("falls back to weekly resets when no account reports a session", () => {
    const [pool] = collectLimitPools(
      [
        account("a", [{ ...weekly, resetsAt: "2026-09-06T12:00:00.000Z" }]),
        account("b", [{ ...weekly, resetsAt: "2026-09-05T12:00:00.000Z" }]),
      ],
      now,
    );
    expect(keys(pool!)).toEqual([["b", "a"]]);
  });
});

describe("/usage-limits", () => {
  const limits = { checkedAt: "2026-09-03T11:00:00.000Z", windows: [window] };
  const selected = provider({
    usageLimits: limits,
    auth: { status: "authenticated", email: "same@example.com" },
  });

  it("merges native workspace duplicates only while the workspace evidence is unambiguous", () => {
    const known = provider({
      ...selected,
      instanceId: ProviderInstanceId.make("workspace-a"),
      auth: { ...selected.auth, workspaceId: "ws-a" },
    });
    const fresh = provider({
      ...known,
      instanceId: ProviderInstanceId.make("workspace-a-fresh"),
      usageLimits: { ...limits, checkedAt: "2026-09-03T11:30:00.000Z" },
    });
    const natives = [known, fresh, selected];
    expect(
      collectProviderUsageLimits(selected.instanceId, natives, now)?.accounts.map(
        (account) => account.id,
      ),
    ).toEqual(["workspace-a-fresh"]);

    const unreadable = provider({
      instanceId: ProviderInstanceId.make("workspace-b"),
      auth: { ...selected.auth, workspaceId: "ws-b" },
    });
    expect(
      collectProviderUsageLimits(
        selected.instanceId,
        [...natives, unreadable],
        now,
      )?.accounts.map((account) => account.id),
    ).toEqual(["workspace-a-fresh", "codex"]);
    expect(
      collectProviderUsageLimits(
        selected.instanceId,
        [...natives, { ...unreadable, usageLimits: limits }],
        now,
      )?.accounts.map((account) => account.id),
    ).toEqual(["workspace-a-fresh", "codex", "workspace-b"]);
  });

});

describe("external usage settings", () => {
  it("deduplicates destinations across accounts and environments without inventing quota pools", () => {
    const managed = provider({
      usageLimits: {
        checkedAt: "2026-09-03T11:00:00.000Z",
        windows: [],
        unavailable: { reason: "unsupported", message: "Track usage in ChatGPT." },
        externalUsage: { label: "ChatGPT usage", url: "https://chatgpt.com/#settings/Usage" },
      },
    });
    const presentations = new Map([
      [
        EnvironmentId.make("a"),
        {
          entry: { target: { label: "A" } },
          serverConfig: {
            providers: [managed, { ...managed, instanceId: ProviderInstanceId.make("personal") }],
          },
        },
      ],
      [
        EnvironmentId.make("b"),
        { entry: { target: { label: "B" } }, serverConfig: { providers: [managed] } },
      ],
    ]);
    expect(collectExternalUsageLinks(presentations)).toEqual([
      {
        ...managed.usageLimits!.externalUsage,
        message: "Track usage in ChatGPT.",
        accounts: [`${managed.instanceId} on A`, "personal on A", `${managed.instanceId} on B`],
      },
    ]);
    expect(collectLimitAccounts(presentations)).toEqual([]);
    expect(collectLimitNotices(presentations)).toEqual([]);
  });
});

describe("ChatGPT sharing presentation", () => {
  it("requires verified sharing metadata rather than the Codex driver or login type", () => {
    const codex = provider({ auth: { status: "authenticated", type: "chatgpt" } });
    expect(usesChatGptSharing(codex)).toBe(false);
    expect(
      usesChatGptSharing({ ...codex, auth: { ...codex.auth, subscriptionSharing: true } }),
    ).toBe(true);
    expect(
      usesChatGptSharing({
        ...codex,
        auth: { status: "unauthenticated", subscriptionSharing: true },
      }),
    ).toBe(false);
  });
});
