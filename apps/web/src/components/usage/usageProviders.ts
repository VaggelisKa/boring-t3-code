import type { UsageProviderKind } from "@t3tools/contracts";

import { ProviderDriverKind } from "@t3tools/contracts";

type UsageProviderPresentation = {
  readonly label: string;
  readonly color: string;
  readonly driverKind: ProviderDriverKind;
};

// The contract still names upstream's usage sources; this build only reads Antigravity transcripts.
const PROVIDER_PRESENTATION: Partial<Record<UsageProviderKind, UsageProviderPresentation>> = {
  antigravity: {
    label: "Antigravity",
    color: "#8c7bd1",
    driverKind: ProviderDriverKind.make("antigravity"),
  },
};

export const PROVIDER_ORDER = Object.keys(PROVIDER_PRESENTATION) as UsageProviderKind[];

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
