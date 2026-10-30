import {
  type EnvironmentId,
  type ModelSelection,
  type ServerSettings,
  type ProjectId,
  resolveProjectProviderInstanceEnabled,
  type UsageLimitsReport,
  type ProviderInstanceId,
  type ProviderConsumeResetCreditInput,
  type ServerProviderSlashCommand,
  isProviderAvailable,
  type ServerProvider,
  type ServerProviderUsageLimits,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";

import * as DateTime from "effect/DateTime";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function exhaustedUsageWindow(
  provider: ServerProvider | undefined,
  now: number,
  model?: string,
) {
  const exhausted = (provider?.usageLimits?.windows ?? []).filter(
    (window) =>
      (window.usedPercent ?? 0) >= 100 &&
      (!window.resetsAt ||
        !Number.isFinite(Date.parse(window.resetsAt)) ||
        Date.parse(window.resetsAt) > now),
  );
  if (model === undefined) return exhausted[0];
  switch (provider?.driver) {
    case "antigravity": {
      const family = model.match(/^(gemini|claude|gpt)-/)?.[1];
      return exhausted.find((window) => {
        const pool = window.id.match(/^(gemini|claude|gpt|3p)-/)?.[1];
        return (
          pool === undefined ||
          family === undefined ||
          pool === family ||
          (pool === "3p" && (family === "claude" || family === "gpt"))
        );
      });
    }
    default:
      return exhausted[0];
  }
}

export function resolveNewThreadModelSelection(input: {
  readonly defaultSelection: ModelSelection | null;
  readonly explicitSelection?: ModelSelection | null;
  readonly fallbackSelection: ModelSelection | null;
  readonly providers: readonly ServerProvider[];
  readonly now: number;
  readonly settings?: ServerSettings;
  readonly projectId?: ProjectId | null;
}) {
  const selection = input.explicitSelection ?? input.defaultSelection;
  const unchanged = { selection, fallback: null };
  if (input.explicitSelection || !selection || !input.fallbackSelection) return unchanged;
  const provider = input.providers.find((entry) => entry.instanceId === selection.instanceId);
  const window = exhaustedUsageWindow(provider, input.now, selection.model);
  const fallback = input.providers.find(
    (entry) => entry.instanceId === input.fallbackSelection?.instanceId,
  );
  if (
    !provider ||
    !window ||
    !fallback?.enabled ||
    !fallback.installed ||
    fallback.auth.status === "unauthenticated" ||
    !isProviderAvailable(fallback) ||
    exhaustedUsageWindow(fallback, input.now, input.fallbackSelection.model) ||
    (input.settings &&
      !resolveProjectProviderInstanceEnabled(
        input.settings,
        input.projectId ?? null,
        fallback.instanceId,
      ))
  )
    return unchanged;
  return {
    selection: input.fallbackSelection,
    fallback: { provider, resetsAt: window.resetsAt ?? null },
  };
}

function providersWithLimits(providers: readonly ServerProvider[]): readonly ServerProvider[] {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      isProviderAvailable(provider) &&
      provider.usageLimits !== undefined,
  );
}

export type LimitPresentations = ReadonlyMap<
  EnvironmentId,
  {
    readonly entry: { readonly target: { readonly label: string } };
    readonly serverConfig: {
      readonly providers: readonly ServerProvider[];
    } | null;
  }
>;

export function collectExternalUsageLinks(presentations: LimitPresentations) {
  const links = new Map<
    string,
    {
      readonly label: string;
      readonly url: string;
      readonly message: string | undefined;
      readonly accounts: readonly string[];
    }
  >();
  for (const presentation of presentations.values()) {
    for (const provider of providersWithLimits(presentation.serverConfig?.providers ?? [])) {
      const external = provider.usageLimits?.externalUsage;
      if (external && provider.auth.status === "authenticated") {
        const account = `${provider.displayName ?? provider.instanceId} on ${presentation.entry.target.label}`;
        links.set(external.url, {
          ...external,
          message: provider.usageLimits?.unavailable?.message,
          accounts: [...new Set([...(links.get(external.url)?.accounts ?? []), account])],
        });
      }
    }
  }
  return [...links.values()];
}

function accountKey(
  driver: ServerProvider["driver"],
  email: string | undefined,
  limits?: ServerProviderUsageLimits,
): string | null {
  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail) return `${driver}:${normalizedEmail}`;
  return limits?.credentialFingerprint
    ? `${driver}:credential:${limits.credentialFingerprint}`
    : null;
}

interface AccountReport {
  readonly driver: ServerProvider["driver"];
  readonly email?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly usageLimits?: ServerProviderUsageLimits | undefined;
}

const nativeReport = (provider: ServerProvider): AccountReport => ({
  driver: provider.driver,
  email: provider.auth.email,
  workspaceId: provider.auth.workspaceId,
  usageLimits: provider.usageLimits,
});

// Include every enabled login, even unreadable workspaces.
function accountKeyResolver(reports: Iterable<AccountReport>) {
  const workspaces = new Map<string, Set<string>>();
  for (const report of reports) {
    const key = accountKey(report.driver, report.email, report.usageLimits);
    if (key && report.workspaceId) {
      workspaces.set(key, (workspaces.get(key) ?? new Set()).add(report.workspaceId));
    }
  }
  return (report: AccountReport): string | null => {
    const key = accountKey(report.driver, report.email, report.usageLimits);
    if (!key) return null;
    if (report.workspaceId) return `${key}:${report.workspaceId}`;
    const known = workspaces.get(key);
    if (!known) return key;
    return known.size === 1 ? `${key}:${[...known][0]}` : null;
  };
}

export interface LimitAccount {
  readonly key: string;
  readonly driver: ServerProvider["driver"];
  readonly displayName: string | null;
  readonly email: string | undefined;
  readonly plan: string | undefined;
  readonly accentColor: string | undefined;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }>;
  readonly sourceLabel: string | null;
  readonly redeem: {
    readonly environmentId: EnvironmentId;
    readonly input: ProviderConsumeResetCreditInput;
  } | null;
  readonly limits: ServerProviderUsageLimits;
}

export function collectLimitAccounts(presentations: LimitPresentations): readonly LimitAccount[] {
  const accounts = new Map<string, LimitAccount>();
  const creditSources = new Map<string, LimitAccount>();
  const hubRedeems = new Map<string, LimitAccount>();
  const merge = (key: string, next: LimitAccount) => {
    // Prefer hub redemption to clear its routing cooldown too; displayed balance still follows the freshest read.
    const previousHub = hubRedeems.get(key);
    if (
      next.redeem &&
      "sourceId" in next.redeem.input &&
      (!previousHub || Date.parse(next.limits.checkedAt) > Date.parse(previousHub.limits.checkedAt))
    ) {
      hubRedeems.set(key, next);
    }
    const previousCredit = creditSources.get(key);
    if (
      next.limits.resetCredits &&
      (!previousCredit ||
        Date.parse(next.limits.checkedAt) > Date.parse(previousCredit.limits.checkedAt))
    ) {
      creditSources.set(key, next);
    }
    const previous = accounts.get(key);
    if (!previous) {
      accounts.set(key, next);
      return;
    }
    const fresher = Date.parse(next.limits.checkedAt) > Date.parse(previous.limits.checkedAt);
    const environments = [
      ...previous.environments,
      ...next.environments.filter(
        (candidate) =>
          !previous.environments.some((seen) => seen.environmentId === candidate.environmentId),
      ),
    ];
    const winner = fresher ? next : previous;
    const creditSource = creditSources.get(key);
    accounts.set(key, {
      ...previous,
      displayName: previous.displayName ?? next.displayName,
      plan: previous.plan ?? next.plan,
      accentColor: previous.accentColor ?? next.accentColor,
      environments,
      sourceLabel: environments.length > 0 ? null : (previous.sourceLabel ?? next.sourceLabel),
      redeem:
        hubRedeems.get(key)?.redeem ??
        (creditSource ? creditSource.redeem : (winner.redeem ?? previous.redeem ?? next.redeem)),
      limits: {
        ...winner.limits,
        ...(creditSource?.limits.resetCredits
          ? { resetCredits: creditSource.limits.resetCredits }
          : { resetCredits: undefined }),
      },
    });
  };
  const resolveKey = accountKeyResolver(
    [...presentations.values()].flatMap((presentation) =>
      (presentation.serverConfig?.providers ?? [])
        .filter((provider) => provider.enabled)
        .map(nativeReport),
    ),
  );
  for (const [environmentId, presentation] of presentations) {
    const label = presentation.entry.target.label;
    for (const provider of providersWithLimits(presentation.serverConfig?.providers ?? [])) {
      if (!provider.usageLimits || limitsNotice(provider.usageLimits) !== null) continue;
      merge(resolveKey(nativeReport(provider)) ?? `${environmentId}:${provider.instanceId}`, {
        key: `${environmentId}:${provider.instanceId}`,
        driver: provider.driver,
        displayName: provider.displayName?.trim() || null,
        email: provider.auth.email,
        plan: provider.auth.label,
        accentColor: provider.accentColor,
        environments: [{ environmentId, label }],
        sourceLabel: null,
        redeem: { environmentId, input: { instanceId: provider.instanceId } },
        limits: provider.usageLimits,
      });
    }
  }
  return [...accounts.values()];
}

export function collectLimitNotices(presentations: LimitPresentations): readonly string[] {
  const label = (environmentLabel: string, subject: string) =>
    presentations.size > 1 ? `${environmentLabel} · ${subject}` : subject;
  const notices: string[] = [];
  for (const presentation of presentations.values()) {
    const environmentLabel = presentation.entry.target.label;
    for (const provider of providersWithLimits(presentation.serverConfig?.providers ?? [])) {
      if (provider.usageLimits?.unavailable?.reason === "unsupported") continue;
      const notice = provider.usageLimits ? limitsNotice(provider.usageLimits) : null;
      const name = provider.displayName?.trim() || String(provider.driver);
      if (notice) notices.push(`${label(environmentLabel, name)}: ${notice}`);
    }
  }
  return notices;
}

export interface LimitPoolMember {
  readonly account: LimitAccount;
  readonly window: ServerProviderUsageWindow;
  readonly refillPercent: number;
}

export interface LimitPoolWindow {
  readonly id: string;
  readonly kind: ServerProviderUsageWindow["kind"];
  readonly label: string;
  readonly members: readonly LimitPoolMember[];
  readonly columns: ReadonlyArray<
    LimitPoolMember | { readonly account: LimitAccount; readonly window: null }
  >;
  readonly remainingPercent: number;
  readonly usedPercent: number;
  readonly pace: LimitPace | null;
  readonly resets: ReadonlyArray<{
    readonly member: LimitPoolMember;
    readonly at: number;
    readonly restoresPercent: number;
  }>;
}

export interface LimitPool {
  readonly driver: ServerProvider["driver"];
  readonly accounts: readonly LimitAccount[];
  readonly windows: readonly LimitPoolWindow[];
}

export function displayLimitWindows(pool: LimitPool) {
  if (pool.driver === "antigravity") {
    return [...pool.windows].sort(
      (left, right) =>
        Number(!left.id.startsWith("gemini-")) - Number(!right.id.startsWith("gemini-")) ||
        left.id
          .replace(/-(5h|weekly|quota)$/, "")
          .localeCompare(right.id.replace(/-(5h|weekly|quota)$/, "")) ||
        WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind],
    );
  }
  return pool.windows;
}

const WINDOW_KIND_ORDER: Record<ServerProviderUsageWindow["kind"], number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

export function collectLimitPools(
  accounts: readonly LimitAccount[],
  now: number,
): readonly LimitPool[] {
  const byDriver = new Map<ServerProvider["driver"], LimitAccount[]>();
  for (const account of accounts) {
    const list = byDriver.get(account.driver);
    if (list) list.push(account);
    else byDriver.set(account.driver, [account]);
  }
  return [...byDriver].map(([driver, members]) => {
    const orderWindow = members
      .flatMap((account) => account.limits.windows)
      .sort((left, right) => WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind])[0];
    const orderReset = (account: LimitAccount) => {
      const window = account.limits.windows.find(
        (window) => orderWindow && poolKey(window) === poolKey(orderWindow),
      );
      return (
        (window ? resetMillis(window) : null) ??
        Number.POSITIVE_INFINITY
      );
    };
    const sorted = [...members].sort(
      (left, right) =>
        orderReset(left) - orderReset(right) ||
        accountSortName(left).localeCompare(accountSortName(right)) ||
        left.key.localeCompare(right.key),
    );
    return { driver, accounts: sorted, windows: poolWindows(sorted, now) };
  });
}

function accountSortName(account: LimitAccount): string {
  return (account.displayName ?? account.email ?? account.key).toLowerCase();
}

function poolKey(window: ServerProviderUsageWindow): string {
  return `${window.kind}:${window.id}`;
}

function poolMember(account: LimitAccount, reported: ServerProviderUsageWindow) {
  return { account, window: reported, refillPercent: reported.usedPercent };
}

function poolWindows(accounts: readonly LimitAccount[], now: number): readonly LimitPoolWindow[] {
  const byKey = new Map<string, LimitPoolMember[]>();
  for (const account of accounts) {
    for (const reported of account.limits.windows) {
      const member = poolMember(account, reported);
      const key = poolKey(reported);
      const list = byKey.get(key);
      if (list) list.push(member);
      else byKey.set(key, [member]);
    }
  }
  const pools = [...byKey.values()].map((members): LimitPoolWindow => {
    const memberByAccount = new Map(members.map((member) => [member.account.key, member]));
    const first = members[0]!.window;
    const usedPercent = members.reduce((sum, m) => sum + m.window.usedPercent, 0) / members.length;
    // Judge pace only for windows with reset clocks; others add spend without elapsed time.
    const timed = members.flatMap((m) => {
      const share = elapsedShare(m.window, now);
      return share === null ? [] : [{ used: m.window.usedPercent, elapsed: share }];
    });
    const timedUsed = timed.reduce((sum, t) => sum + t.used, 0) / timed.length;
    const meanElapsed =
      timed.length > 0 ? timed.reduce((sum, t) => sum + t.elapsed, 0) / timed.length : null;
    const resets = members
      .flatMap((member) => {
        const at = resetMillis(member.window);
        return at === null
          ? []
          : [
              {
                member,
                at,
                restoresPercent: Math.round(member.refillPercent / members.length),
              },
            ];
      })
      .sort((left, right) => left.at - right.at);
    return {
      id: first.id,
      kind: first.kind,
      label: first.label,
      members,
      columns: accounts.map(
        (account) => memberByAccount.get(account.key) ?? { account, window: null },
      ),
      usedPercent: Math.round(usedPercent),
      remainingPercent: Math.round(100 - usedPercent),
      pace: meanElapsed === null ? null : paceOfShares(timedUsed, meanElapsed),
      resets,
    };
  });
  return pools.sort((left, right) => WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind]);
}

export function limitsNotice(limits: ServerProviderUsageLimits): string | null {
  if (limits.unavailable?.reason === "unsupported") {
    return limits.unavailable.message ?? "This account has no subscription limits.";
  }
  if (limits.unavailable?.reason === "probeFailed") {
    return limits.unavailable.message ?? "Could not read limits.";
  }
  return limits.windows.length === 0 ? "No limits reported." : null;
}

export function remainingPercent(window: ServerProviderUsageWindow): number {
  return Math.round(100 - Math.max(0, Math.min(100, window.usedPercent)));
}

function resetMillis(window: ServerProviderUsageWindow): number | null {
  if (window.resetsAt === undefined) return null;
  const at = Date.parse(window.resetsAt);
  return Number.isFinite(at) ? at : null;
}

export function elapsedShare(window: ServerProviderUsageWindow, now: number): number | null {
  const resetsAt = resetMillis(window);
  if (resetsAt === null || window.windowDurationMins === undefined) return null;
  const length = window.windowDurationMins * MINUTE;
  if (length <= 0) return null;
  return Math.max(0, Math.min(1, (length - (resetsAt - now)) / length));
}

// Bars show quota remaining, so even pace tracks time remaining.
export function paceRemainingPercent(
  window: ServerProviderUsageWindow,
  now: number,
): number | null {
  const elapsed = elapsedShare(window, now);
  return elapsed === null ? null : Math.round((1 - elapsed) * 100);
}

export type LimitPace = "ahead" | "on" | "under";

export function paceOf(window: ServerProviderUsageWindow, now: number): LimitPace | null {
  const elapsed = elapsedShare(window, now);
  return elapsed === null ? null : paceOfShares(window.usedPercent, elapsed);
}

function paceOfShares(usedPercent: number, elapsed: number): LimitPace {
  const gap = usedPercent - elapsed * 100;
  if (gap > 5) return "ahead";
  if (gap < -5) return "under";
  return "on";
}

export function formatDuration(ms: number): string {
  const remaining = Math.max(0, ms);
  const days = Math.floor(remaining / DAY);
  const hours = Math.floor((remaining % DAY) / HOUR);
  const minutes = Math.floor((remaining % HOUR) / MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatResetsIn(window: ServerProviderUsageWindow, now: number): string | null {
  const resetsAt = resetMillis(window);
  if (resetsAt === null) return null;
  if (resetsAt <= now) return "resets now";
  if (resetsAt - now < MINUTE) return "Resets momentarily";
  return `resets in ${formatDuration(resetsAt - now)}`;
}

export const USAGE_LIMITS_COMMAND = {
  name: "usage-limits",
  description: "Show this provider's usage limits",
} satisfies ServerProviderSlashCommand;

export function isUsageLimitsCommand(prompt: string): boolean {
  return prompt.trim().toLowerCase() === "/usage-limits";
}

export function hasProviderUsageLimits(
  driver: ServerProvider["driver"],
  providers: readonly ServerProvider[],
): boolean {
  return providersWithLimits(providers).some((provider) => provider.driver === driver);
}

/** Advertise on workspace catalogs too, which replace the global command list. */
export function withUsageLimitsCommands(providers: readonly ServerProvider[]): ServerProvider[] {
  return providers.map((provider) => {
    if (!hasProviderUsageLimits(provider.driver, providers)) return provider;
    const commands = (items: readonly ServerProviderSlashCommand[]) => [
      ...items.filter((command) => command.name !== USAGE_LIMITS_COMMAND.name),
      USAGE_LIMITS_COMMAND,
    ];
    return {
      ...provider,
      slashCommands: commands(provider.slashCommands),
      ...(provider.workspaceSnapshots
        ? {
            workspaceSnapshots: provider.workspaceSnapshots.map((snapshot) => ({
              ...snapshot,
              slashCommands: commands(snapshot.slashCommands),
            })),
          }
        : {}),
    };
  });
}

export function collectProviderUsageLimits(
  instanceId: ProviderInstanceId,
  providers: readonly ServerProvider[],
  now: number,
): UsageLimitsReport | null {
  const selected = providers.find((provider) => provider.instanceId === instanceId);
  if (!selected || !hasProviderUsageLimits(selected.driver, providers)) return null;
  const resolveKey = accountKeyResolver(
    providers.filter((provider) => provider.enabled).map(nativeReport),
  );
  type NativeSnapshot = { provider: ServerProvider; limits: ServerProviderUsageLimits };
  const nativeByAccount = new Map<
    string,
    { usage: NativeSnapshot; credits: NativeSnapshot | null }
  >();
  for (const provider of providersWithLimits(providers)) {
    if (provider.driver !== selected.driver || !provider.usageLimits) continue;
    const snapshot = { provider, limits: provider.usageLimits };
    const key = resolveKey(nativeReport(provider)) ?? `instance:${provider.instanceId}`;
    const previous = nativeByAccount.get(key);
    const previousUsable = previous ? limitsNotice(previous.usage.limits) === null : false;
    const usable = limitsNotice(snapshot.limits) === null;
    const providerWins =
      !previous ||
      (usable && !previousUsable) ||
      (usable === previousUsable &&
        Date.parse(snapshot.limits.checkedAt) > Date.parse(previous.usage.limits.checkedAt));
    const previousCredit = previous?.credits;
    const credits =
      snapshot.limits.resetCredits &&
      (!previousCredit ||
        Date.parse(snapshot.limits.checkedAt) > Date.parse(previousCredit.limits.checkedAt))
        ? snapshot
        : (previousCredit ?? null);
    nativeByAccount.set(key, {
      usage: providerWins ? snapshot : previous.usage,
      credits,
    });
  }
  const native = [...nativeByAccount.values()];
  const accounts: Array<UsageLimitsReport["accounts"][number]> = [];
  const notices: string[] = [];
  for (const {
    usage: { provider, limits },
    credits,
  } of native) {
    const shownCredits = credits?.limits.resetCredits;
    accounts.push({
      id: provider.instanceId,
      driver: provider.driver,
      label: `${provider.displayName?.trim() || String(provider.driver)} [${provider.instanceId}]`,
      ...(provider.auth.label ? { plan: provider.auth.label } : {}),
      instanceId: provider.instanceId,
      resetCreditInput: { instanceId: credits?.provider.instanceId ?? provider.instanceId },
      ...(provider.displayName ? { displayName: provider.displayName } : {}),
      ...(provider.accentColor ? { accentColor: provider.accentColor } : {}),
      ...(provider.auth.email ? { email: provider.auth.email } : {}),
      limits: shownCredits ? { ...limits, resetCredits: shownCredits } : limits,
    });
  }
  return { createdAt: DateTime.formatIso(DateTime.makeUnsafe(now)), accounts, notices };
}
