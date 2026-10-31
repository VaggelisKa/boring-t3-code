import { ProviderDriverKind, UsageProviderKind } from "@t3tools/contracts";

type UsageProviderPresentation = {
  readonly label: string;
  readonly color: string;
  readonly driverKind: ProviderDriverKind;
};

// The contract still names upstream's usage sources. This build only reads Antigravity transcripts,
// but rows from an upstream server still get a band and a filter so totals add up.
const PROVIDER_PRESENTATION: Partial<Record<UsageProviderKind, UsageProviderPresentation>> = {
  antigravity: {
    label: "Antigravity",
    color: "#8c7bd1",
    driverKind: ProviderDriverKind.make("antigravity"),
  },
};

export const PROVIDER_ORDER: readonly UsageProviderKind[] = [
  "antigravity",
  ...UsageProviderKind.literals.filter((provider) => provider !== "antigravity"),
];

export function providerPresentation(provider: UsageProviderKind): UsageProviderPresentation {
  return (
    PROVIDER_PRESENTATION[provider] ?? {
      label: provider,
      color: "var(--muted-foreground)",
      driverKind: ProviderDriverKind.make(provider),
    }
  );
}

export function providersWithUsage(
  totals: readonly {
    readonly provider: UsageProviderKind;
    readonly costUsd: number;
    readonly totalTokens: number;
  }[],
): readonly UsageProviderKind[] {
  const active = new Set(
    totals
      .filter((entry) => entry.totalTokens > 0 || entry.costUsd > 0)
      .map((entry) => entry.provider),
  );
  return PROVIDER_ORDER.filter((provider) => active.has(provider));
}
