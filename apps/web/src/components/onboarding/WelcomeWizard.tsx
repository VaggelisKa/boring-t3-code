import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScopedProjectRef, ServerProvider } from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";
import { ArrowRightIcon, CheckIcon, MonitorIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { completeOnboarding } from "../../onboarding/firstRun";
import {
  getOnboardingProviderState,
  selectOnboardingProvidersByDriver,
} from "../../onboarding/providerReadiness.logic";
import {
  type EnvironmentPresentation,
  useEnvironments,
  usePrimaryEnvironment,
} from "../../state/environments";
import { resolveOnboardingSetup } from "../../onboarding/targetEnvironment.logic";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { getProviderSummary } from "../settings/providerStatus";
import { providerClients } from "../settings/providerDriverMeta";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { T3Wordmark } from "../T3Wordmark";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { ScrollArea } from "../ui/scroll-area";
import { WizardPanel, WizardSteps, WizardPopup, WizardHeader } from "../ui/wizard";
import { Dialog } from "../ui/dialog";
import { toastManager } from "../ui/toast";

type WizardStep = "connection" | "agents";

const ONBOARDING_STAGES = ["Connect", "Agents"] as const;

export function WelcomeWizard({
  onDone,
  resumeEnvironmentId,
}: {
  readonly resumeEnvironmentId?: EnvironmentId | undefined;
  readonly onDone: (projectRef?: ScopedProjectRef) => void | Promise<void>;
}) {
  const [step, setStep] = useState<WizardStep>(resumeEnvironmentId ? "agents" : "connection");
  const { environments } = useEnvironments();
  const [selection, setSelection] = useState<ReadonlySet<EnvironmentId> | null>(null);
  // Share the registry for the wizard's lifetime so unchecked computers are not auto-selected again.
  const [autoSelectedComputers] = useState(() => new Set<EnvironmentId>());
  const [setupIds, setSetupIds] = useState<readonly EnvironmentId[]>(
    resumeEnvironmentId ? [resumeEnvironmentId] : [],
  );
  const finishingPromiseRef = useRef<Promise<boolean> | null>(null);
  const completionErrorToastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);
  const primaryEnvironment = usePrimaryEnvironment();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- marks newly listed computers in the shared auto-select registry once and selects the enabled ones
  useEffect(() => {
    const newComputers = environments.filter(
      (environment) => !autoSelectedComputers.has(environment.environmentId),
    );
    if (newComputers.length === 0) return;
    for (const environment of newComputers) {
      autoSelectedComputers.add(environment.environmentId);
    }
    const enabledComputers = newComputers.filter((environment) => environment.entry.enabled);
    if (enabledComputers.length === 0) return;
    // oxlint-disable-next-line react/set-state-in-effect -- The registry marks each computer once, and only after commit; render must not mutate it.
    setSelection(
      (current) =>
        new Set([
          ...(current ?? []),
          ...enabledComputers.map((environment) => environment.environmentId),
        ]),
    );
  }, [autoSelectedComputers, environments]);
  const selectedIds =
    selection ?? new Set(primaryEnvironment ? [primaryEnvironment.environmentId] : []);
  const startSetup = (ids: readonly EnvironmentId[]) => {
    if (ids.length === 0) return;
    setSetupIds(ids);
    setStep("agents");
  };
  const stageIndex = step === "agents" ? 1 : 0;
  const finish = () => {
    if (finishingPromiseRef.current !== null) return finishingPromiseRef.current;
    if (completionErrorToastIdRef.current !== null) {
      toastManager.close(completionErrorToastIdRef.current);
      completionErrorToastIdRef.current = null;
    }

    const completion = completeOnboarding()
      .then(async () => {
        if (completionErrorToastIdRef.current !== null) {
          toastManager.close(completionErrorToastIdRef.current);
          completionErrorToastIdRef.current = null;
        }
        await onDone();
        return true;
      })
      .catch(() => {
        const errorToast = {
          type: "error",
          title: "Could not finish setup",
          description: "Your settings could not be saved. Try again.",
        } as const;
        if (completionErrorToastIdRef.current === null) {
          completionErrorToastIdRef.current = toastManager.add(errorToast);
        } else {
          toastManager.update(completionErrorToastIdRef.current, errorToast);
        }
        return false;
      })
      .finally(() => {
        if (finishingPromiseRef.current === completion) {
          finishingPromiseRef.current = null;
        }
      });
    finishingPromiseRef.current = completion;
    return completion;
  };

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(_, event) => {
        event.cancel();
        if (event.reason === "close-press") void finish();
      }}
    >
      <WizardPopup size="wide" bottomStickOnMobile={false}>
        <WizardHeader
          title="Set up T3 Code"
          identity={
            <div className="flex items-baseline gap-1.5" role="img" aria-label="T3 Code">
              <T3Wordmark className="h-4 w-auto shrink-0" aria-hidden />
              <span className="text-2xl font-medium tracking-tight text-muted-foreground">
                Code
              </span>
            </div>
          }
        >
          <WizardSteps
            steps={ONBOARDING_STAGES}
            currentStep={stageIndex}
            isStepDisabled={(index) => index >= stageIndex}
            onStepChange={(index) => {
              if (index > stageIndex) return;
              setStep(index === 0 ? "connection" : "agents");
            }}
          />
        </WizardHeader>

        <WizardPanel>
          {step === "connection" ? (
            <ConnectionStep
              selectedIds={selectedIds}
              onSelectionChange={setSelection}
              onContinue={() =>
                startSetup(resolveOnboardingSetup(environments, selectedIds).environmentIds)
              }
            />
          ) : (
            <AgentsStep environmentIds={setupIds} onContinue={() => void finish()} />
          )}
        </WizardPanel>
      </WizardPopup>
    </Dialog>
  );
}

const CONNECTION_PHASE_LABELS: Readonly<
  Record<EnvironmentPresentation["connection"]["phase"], string>
> = {
  connected: "Connected",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  unsupported: "Client not supported",
  error: "Connection failed",
  offline: "Offline",
  available: "Not connected",
};

function ConnectionStep({
  selectedIds,
  onSelectionChange,
  onContinue,
}: {
  readonly selectedIds: ReadonlySet<EnvironmentId>;
  readonly onSelectionChange: (ids: ReadonlySet<EnvironmentId>) => void;
  readonly onContinue: () => void;
}) {
  const { environments } = useEnvironments();
  const { ready, skippedIds } = resolveOnboardingSetup(environments, selectedIds);
  const skippedLabels = environments
    .filter((environment) => skippedIds.includes(environment.environmentId))
    .map((environment) => environment.label);
  const continueRef = useRef<HTMLButtonElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves DOM focus to the Continue button once setup is ready and nothing else holds focus
  useEffect(() => {
    if (
      ready &&
      (document.activeElement === document.body ||
        document.activeElement?.getAttribute("role") === "dialog")
    ) {
      continueRef.current?.focus();
    }
  }, [ready]);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Choose your environments
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
        Choose one or more environments on this computer. We’ll set up agents and projects on each.
      </p>
      {environments.length > 0 ? (
        <fieldset className="mt-5 space-y-2">
          <legend className="sr-only">Computers to set up</legend>
          {environments.map((environment) => (
            <label
              key={environment.environmentId}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-3"
            >
              <Checkbox
                checked={selectedIds.has(environment.environmentId)}
                onCheckedChange={(checked) => {
                  const next = new Set(selectedIds);
                  if (checked) next.add(environment.environmentId);
                  else next.delete(environment.environmentId);
                  onSelectionChange(next);
                }}
              />
              <MonitorIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-sm font-medium break-words">
                    {environment.label}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {!environment.entry.enabled && environment.connection.phase !== "unsupported"
                      ? "Off"
                      : CONNECTION_PHASE_LABELS[environment.connection.phase]}
                  </span>
                </span>
                {environment.displayUrl ? (
                  <span className="mt-0.5 block text-xs break-all text-muted-foreground">
                    {environment.displayUrl}
                  </span>
                ) : null}
                {environment.connection.phase === "unsupported" && environment.connection.error ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {environment.connection.error}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {skippedLabels.length > 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Not connected, so setup skips {skippedLabels.join(", ")}. You can set{" "}
          {skippedLabels.length === 1 ? "it" : "them"} up later from Settings.
        </p>
      ) : null}
      <div className="mt-6 flex justify-end">
        <Button
          className="shrink-0 self-end"
          ref={continueRef}
          autoFocus
          disabled={!ready}
          onClick={onContinue}
        >
          Continue
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
    </>
  );
}

const ONBOARDING_AGENT_DRIVER = ProviderDriverKind.make("antigravity");

function AgentsStep({
  environmentIds,
  onContinue,
}: {
  readonly environmentIds: readonly EnvironmentId[];
  readonly onContinue: () => void;
}) {
  const { environments } = useEnvironments();
  return (
    <StepShell
      title="Connect your agents"
      description="Choose an agent to start coding. You can add more later."
    >
      <ScrollArea scrollFade className="mt-5 h-auto max-h-[min(32rem,55dvh)]">
        <div className="space-y-5 pr-3">
          {environmentIds.map((environmentId) => (
            <ConnectedAgentsStep
              key={environmentId}
              environmentId={environmentId}
              machineLabel={
                environments.find((environment) => environment.environmentId === environmentId)
                  ?.label ?? "Computer"
              }
            />
          ))}
        </div>
      </ScrollArea>
      <div className="mt-6 flex justify-end">
        <Button autoFocus onClick={onContinue}>
          Continue
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
    </StepShell>
  );
}

function ConnectedAgentsStep({
  environmentId,
  machineLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly machineLabel: string;
}) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the environment to refresh its provider list when the environment changes
  useEffect(() => {
    void refreshProviders({ environmentId, input: {} });
  }, [environmentId, refreshProviders]);

  const provider = selectOnboardingProvidersByDriver(providers).get(ONBOARDING_AGENT_DRIVER);
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{machineLabel}</h2>
      <AgentCard provider={provider} />
    </section>
  );
}

function AgentCard({ provider }: { readonly provider: ServerProvider | undefined }) {
  const displayName =
    provider?.displayName || (providerClients.get(ONBOARDING_AGENT_DRIVER)?.label ?? "Antigravity");
  const summary = getProviderSummary(provider);
  const providerState = getOnboardingProviderState(provider);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-4">
      <ProviderInstanceIcon
        driverKind={ONBOARDING_AGENT_DRIVER}
        displayName={displayName}
        iconClassName="size-5"
      />
      <div className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{displayName}</span>
        <p className="mt-0.5 text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
          {providerState === "ready" ? "Ready to code." : summary.headline}
          {providerState !== "ready" && summary.detail ? ` · ${summary.detail}` : ""}
        </p>
      </div>
      <div className="shrink-0">
        {providerState === "ready" ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-foreground">
            <CheckIcon className="size-3.5" />
            Ready
          </span>
        ) : providerState === "checking" ? (
          <span className="text-xs text-muted-foreground">Checking...</span>
        ) : providerState === "disabled" ? (
          <span className="text-xs text-muted-foreground">Disabled</span>
        ) : null}
      </div>
    </div>
  );
}

function StepShell({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      {description ? (
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {children}
    </>
  );
}
