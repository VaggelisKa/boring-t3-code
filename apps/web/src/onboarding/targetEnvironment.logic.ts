import type { EnvironmentId } from "@t3tools/contracts";

/** Waits only for first connection attempts; offline, failing, or unsupported computers cannot block setup. */
export function resolveOnboardingSetup(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly connection: { readonly phase: string };
  }>,
  selectedIds: ReadonlySet<EnvironmentId>,
): {
  readonly ready: boolean;
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly skippedIds: ReadonlyArray<EnvironmentId>;
} {
  const selected = environments.filter((environment) => selectedIds.has(environment.environmentId));
  const idsInPhase = (keep: (phase: string) => boolean) =>
    selected
      .filter((environment) => keep(environment.connection.phase))
      .map((environment) => environment.environmentId);
  const environmentIds = idsInPhase((phase) => phase === "connected");
  const settling = selected.some((environment) => environment.connection.phase === "connecting");
  return {
    ready: environmentIds.length > 0 && !settling,
    environmentIds,
    skippedIds: idsInPhase((phase) => phase !== "connected" && phase !== "connecting"),
  };
}
