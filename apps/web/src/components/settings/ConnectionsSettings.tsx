import { SessionPermissions } from "./SessionPermissions";
import { ChevronRightIcon, EllipsisIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { AuthAccessReadScope, AuthAccessWriteScope, AuthEnvironmentMaintainScope, type AuthClientSession, type AuthPairingLink, type DesktopWslState, resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";

import { isLocalEnvironmentDisabled } from "../../localEnvironment";
import { applyWslEnableSelection, isWslSettingsRowVisible, resolveLocalVersionStatusLabel } from "./ConnectionsSettings.logic";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { LocalEnvironmentSetting } from "./LocalEnvironmentSetting";
import { searchableSetting } from "./settingsSearch";
import { EnvironmentIconMenu } from "./EnvironmentIconPicker";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { LoadBalancingSettings } from "./LoadBalancingSettings";
import { PullRequestRoutingSettings } from "./PullRequestRoutingSettings";
import { ScrollArea } from "../ui/scroll-area";
import { AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle } from "../ui/alert-dialog";
import { Spinner } from "../ui/spinner";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { revokeOtherServerClientSessions, revokeServerClientSession, revokeServerPairingLink, type ServerClientSessionRecord } from "~/environments/primary";
import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import { resolveServerConfigVersionMismatch, resolveServerSelfUpdateCapability, supportsDesktopAppUpdate } from "~/versionSkew";
import { authEnvironment } from "~/state/auth";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";
import { useEnvironmentQuery } from "~/state/query";
import { desktopWslStateAtom, refreshDesktopWslState } from "~/state/desktopWslState";
import { useDesktopUpdateState } from "~/state/desktopUpdate";
import { useEnvironments, usePrimaryEnvironment } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { ServerUpdateAction, ServerUpdateProgress } from "../ServerUpdateAction";
import { sortDesktopPairingLinks, summarizeAuthorizedClients, sortDesktopClientSessions, toDesktopPairingLinkRecord, toDesktopClientSessionRecord } from "./ConnectionsSettings.logic";
import { AuthorizedClientsHeaderAction, PairingClientsList } from "./AuthorizedClientsSettings";
import { ITEM_ROW_CLASSNAME } from "./itemRows";

// Colons are invalid in distro names, keeping picker sentinels collision-free.
const BACKEND_VALUE_DEFAULT_WSL = "backend:default-wsl";
const BACKEND_VALUE_WSL_OFF = "backend:wsl-off";

// Subscribes on its own so desktop download progress does not re-render the page.
function LocalVersionStatusLabel() {
  const updateState = useDesktopUpdateState();
  return (
    <span className="text-xs text-muted-foreground">
      {resolveLocalVersionStatusLabel(updateState)}
    </span>
  );
}

/** Environments lists the machines this app connects to; access covers who may reach this one. */
export function ConnectionsSettings({ view }: { readonly view: "environments" | "access" }) {
  const desktopBridge = window.desktopBridge;
  const { environments } = useEnvironments();
  const primaryEnvironment = usePrimaryEnvironment();
  const primaryEnvironmentId = primaryEnvironment?.environmentId ?? null;
  const savedEnvironments = environments.filter(
    (environment) => environment.entry.target._tag !== "PrimaryConnectionTarget",
  );
  const loadBalancingEnvironments = [
    ...(primaryEnvironment ? [primaryEnvironment] : []),
    ...savedEnvironments.filter((environment) => environment.entry.enabled),
  ].filter((environment) => environment.connection.phase !== "unsupported");
  const [desktopAccessManagementMutationError, setDesktopAccessManagementMutationError] = useState<
    string | null
  >(null);
  const [revokingDesktopPairingLinkId, setRevokingDesktopPairingLinkId] = useState<string | null>(
    null,
  );
  const [revokingDesktopClientSessionId, setRevokingDesktopClientSessionId] = useState<
    string | null
  >(null);
  const [isRevokingOtherDesktopClients, setIsRevokingOtherDesktopClients] = useState(false);
  const [isUpdatingWslBackend, setIsUpdatingWslBackend] = useState(false);
  const [desktopWslMutationError, setDesktopWslMutationError] = useState<string | null>(null);
  type PendingWslChange =
    | { readonly kind: "disable"; readonly wasWslOnly: boolean }
    | { readonly kind: "distro"; readonly nextDistro: string | null }
    | { readonly kind: "enable"; readonly nextDistro: string | null }
    | { readonly kind: "wsl-only"; readonly nextValue: boolean };
  const [pendingWslChange, setPendingWslChange] = useState<PendingWslChange | null>(null);
  const isWslConfirmDialogOpen = pendingWslChange !== null;
  const primaryServerConfig = primaryEnvironment?.serverConfig ?? null;
  const primaryVersionMismatch = resolveServerConfigVersionMismatch(primaryServerConfig);
  const primaryServerUpdateState = useAtomValue(
    serverEnvironment.updateStateAtom(primaryEnvironmentId),
  );
  const canReadAccess = useEnvironmentScope(primaryEnvironmentId, AuthAccessReadScope);
  const canWriteAccess = useEnvironmentScope(primaryEnvironmentId, AuthAccessWriteScope);
  const canMaintain = useEnvironmentScope(primaryEnvironmentId, AuthEnvironmentMaintainScope);
  const canManageLocalBackend = !isLocalEnvironmentDisabled() && canMaintain;
  const showsAccess = view === "access";
  const authAccessChanges = useEnvironmentQuery(
    showsAccess && canReadAccess && primaryEnvironmentId !== null
      ? authEnvironment.accessChanges({
          environmentId: primaryEnvironmentId,
          input: null,
        })
      : null,
  );
  const desktopWsl = useEnvironmentQuery(
    showsAccess && canManageLocalBackend && desktopBridge ? desktopWslStateAtom : null,
  );
  const desktopWslState = desktopWsl.data;
  const desktopWslError = desktopWslMutationError ?? desktopWsl.error;
  const isLoadingWslState = desktopWsl.isPending && desktopWsl.data === null;
  const desktopAccessManagementError =
    desktopAccessManagementMutationError ?? authAccessChanges.error;
  const isLoadingDesktopAccessManagement =
    authAccessChanges.isPending && authAccessChanges.data === null;
  const desktopPairingLinks = (() => {
    const event = authAccessChanges.data;
    if (event?.type !== "snapshot") return [];
    return sortDesktopPairingLinks(
      event.payload.pairingLinks.map((pairingLink: AuthPairingLink) =>
        toDesktopPairingLinkRecord(pairingLink),
      ),
    );
  })();
  const desktopClientSessions = (() => {
    const event = authAccessChanges.data;
    if (event?.type !== "snapshot") return [];
    return sortDesktopClientSessions(
      event.payload.clientSessions.map((clientSession: AuthClientSession) =>
        toDesktopClientSessionRecord(clientSession),
      ),
    );
  })();
  const handleRevokeDesktopPairingLink = async (id: string) => {
    if (
      primaryEnvironmentId === null ||
      !readEnvironmentScope(primaryEnvironmentId, AuthAccessWriteScope)
    )
      return;
    setRevokingDesktopPairingLinkId(id);
    setDesktopAccessManagementMutationError(null);
    const settled = await settlePromise(async () => {
      await revokeServerPairingLink(id);
    });
    if (settled._tag === "Failure") {
      const error = Cause.squash(settled.cause);
      const message = error instanceof Error ? error.message : "Failed to revoke pairing link.";
      setDesktopAccessManagementMutationError(message);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not revoke pairing link",
          description: message,
        }),
      );
    }
    setRevokingDesktopPairingLinkId(null);
  };

  const handleRevokeDesktopClientSession = async (
    sessionId: ServerClientSessionRecord["sessionId"],
  ) => {
    if (
      primaryEnvironmentId === null ||
      !readEnvironmentScope(primaryEnvironmentId, AuthAccessWriteScope)
    )
      return;
    setRevokingDesktopClientSessionId(sessionId);
    setDesktopAccessManagementMutationError(null);
    const settled = await settlePromise(async () => {
      await revokeServerClientSession(sessionId);
    });
    if (settled._tag === "Failure") {
      const error = Cause.squash(settled.cause);
      const message = error instanceof Error ? error.message : "Failed to revoke client access.";
      setDesktopAccessManagementMutationError(message);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not revoke client access",
          description: message,
        }),
      );
    }
    setRevokingDesktopClientSessionId(null);
  };

  const handleRevokeOtherDesktopClients = async () => {
    if (
      primaryEnvironmentId === null ||
      !readEnvironmentScope(primaryEnvironmentId, AuthAccessWriteScope)
    )
      return;
    setIsRevokingOtherDesktopClients(true);
    setDesktopAccessManagementMutationError(null);
    const settled = await settlePromise(async () => {
      const revokedCount = await revokeOtherServerClientSessions();
      toastManager.add({
        type: "success",
        title: revokedCount === 1 ? "Revoked 1 other client" : `Revoked ${revokedCount} clients`,
        description: "Other paired clients will need a new pairing link before reconnecting.",
      });
    });
    if (settled._tag === "Failure") {
      const error = Cause.squash(settled.cause);
      const message = error instanceof Error ? error.message : "Failed to revoke other clients.";
      setDesktopAccessManagementMutationError(message);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not revoke other clients",
          description: message,
        }),
      );
    }
    setIsRevokingOtherDesktopClients(false);
  };

  const applyWslSettingChange = async (apply: () => Promise<DesktopWslState>) => {
    if (
      !desktopBridge ||
      primaryEnvironmentId === null ||
      !readEnvironmentScope(primaryEnvironmentId, AuthEnvironmentMaintainScope)
    )
      return;
    setIsUpdatingWslBackend(true);
    setDesktopWslMutationError(null);
    const settled = await settlePromise(async () => {
      await apply();
      refreshDesktopWslState();
    });
    if (settled._tag === "Failure") {
      const error = Cause.squash(settled.cause);
      const message = error instanceof Error ? error.message : "Failed to update WSL backend.";
      setDesktopWslMutationError(message);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not change WSL backend",
          description: message,
        }),
      );
      refreshDesktopWslState();
    }
    setIsUpdatingWslBackend(false);
  };

  const loadWslState = () => {
    setDesktopWslMutationError(null);
    refreshDesktopWslState();
  };

  const hasWslRegistrationToLose = environments.some((environment) =>
    isDesktopLocalConnectionTarget(environment.entry.target),
  );

  const handleSelectWslMode = (value: string) => {
    if (!desktopBridge || !desktopWslState) return;
    const defaultDistroName =
      desktopWslState.distros.find((distro) => distro.isDefault)?.name ?? null;
    if (value === BACKEND_VALUE_WSL_OFF) {
      // Unavailable WSL can remain wslOnly while disabled; switching to Windows must clear both.
      if (!desktopWslState.enabled && !desktopWslState.wslOnly) return;
      const wasWslOnly = desktopWslState.wslOnly;
      if (hasWslRegistrationToLose || wasWslOnly) {
        setPendingWslChange({ kind: "disable", wasWslOnly });
        return;
      }
      void applyWslSettingChange(() => desktopBridge.setWslBackendEnabled(false));
      return;
    }
    const nextDistro = value === BACKEND_VALUE_DEFAULT_WSL ? null : value;
    const resolvedNext = nextDistro ?? defaultDistroName;
    if (!desktopWslState.enabled) {
      setPendingWslChange({ kind: "enable", nextDistro });
      return;
    }
    const resolvedCurrent = desktopWslState.distro ?? defaultDistroName;
    if (resolvedCurrent === resolvedNext) return;
    if (hasWslRegistrationToLose || desktopWslState.wslOnly) {
      setPendingWslChange({ kind: "distro", nextDistro });
      return;
    }
    void applyWslSettingChange(() => desktopBridge.setWslDistro(nextDistro));
  };

  const handleConfirmEnableWsl = (mode: "both" | "wsl-only") => {
    if (!desktopBridge || !pendingWslChange || pendingWslChange.kind !== "enable") return;
    const nextDistro = pendingWslChange.nextDistro;
    setPendingWslChange(null);
    const persistedDistro = desktopWslState?.distro ?? null;
    void applyWslSettingChange(() =>
      applyWslEnableSelection({
        bridge: desktopBridge,
        mode,
        nextDistro,
        persistedDistro,
      }),
    );
  };

  const handleToggleWslOnly = (enabled: boolean) => {
    if (!desktopBridge || !desktopWslState || desktopWslState.wslOnly === enabled) return;
    setPendingWslChange({ kind: "wsl-only", nextValue: enabled });
  };

  const handleConfirmWslChange = () => {
    if (!desktopBridge || !pendingWslChange) return;
    const change = pendingWslChange;
    if (change.kind === "enable") return;
    setPendingWslChange(null);
    if (change.kind === "disable") {
      void applyWslSettingChange(async () => {
        const next = await desktopBridge.setWslBackendEnabled(false);
        if (change.wasWslOnly) {
          return await desktopBridge.setWslOnly(false);
        }
        return next;
      });
      return;
    }
    if (change.kind === "distro") {
      void applyWslSettingChange(() => desktopBridge.setWslDistro(change.nextDistro));
      return;
    }
    void applyWslSettingChange(() => desktopBridge.setWslOnly(change.nextValue));
  };

  const renderWslRow = () => {
    if (!desktopWslState) {
      if (
        isWslSettingsRowVisible({ state: null, error: desktopWslError }) &&
        canManageLocalBackend
      ) {
        return (
          <SettingsRow
            {...searchableSetting("wsl-backend")}
            description="Couldn't load the WSL backend state."
            status={<span className="block text-destructive">{desktopWslError}</span>}
            control={
              <Button
                size="sm"
                variant="outline"
                onClick={loadWslState}
                disabled={isLoadingWslState}
              >
                {isLoadingWslState ? "Retrying…" : "Retry"}
              </Button>
            }
          />
        );
      }
      return null;
    }
    if (!isWslSettingsRowVisible({ state: desktopWslState, error: desktopWslError })) {
      return null;
    }
    if (!desktopWslState.available) {
      return (
        <SettingsRow
          {...searchableSetting("wsl-backend")}
          description="WSL is unavailable, so Windows is running instead. Turn WSL off to clear this preference."
          status={
            desktopWslError ? (
              <span className="block text-destructive">{desktopWslError}</span>
            ) : null
          }
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={isUpdatingWslBackend}
              onClick={() => handleSelectWslMode(BACKEND_VALUE_WSL_OFF)}
            >
              Switch to Windows
            </Button>
          }
        />
      );
    }
    const defaultDistroName =
      desktopWslState.distros.find((distro) => distro.isDefault)?.name ?? null;
    const selectValue = !desktopWslState.enabled
      ? BACKEND_VALUE_WSL_OFF
      : (desktopWslState.distro ?? defaultDistroName ?? BACKEND_VALUE_DEFAULT_WSL);
    const selectLabel =
      selectValue === BACKEND_VALUE_WSL_OFF
        ? "Off"
        : selectValue === BACKEND_VALUE_DEFAULT_WSL
          ? "Default distro"
          : selectValue;
    return (
      <>
        <SettingsRow
          {...searchableSetting("wsl-backend")}
          description="Run the selected WSL distro alongside Windows. Projects remain on their current filesystem."
          status={
            desktopWslError ? (
              <span className="block text-destructive">{desktopWslError}</span>
            ) : desktopWslState.preflightError ? (
              <span className="block text-destructive">
                WSL backend couldn't start: {desktopWslState.preflightError}
              </span>
            ) : null
          }
          control={
            <Select
              value={selectValue}
              onValueChange={(value) => {
                if (typeof value !== "string") return;
                handleSelectWslMode(value);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-56"
                aria-label="WSL backend"
                disabled={isUpdatingWslBackend}
              >
                <SelectValue>{selectLabel}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value={BACKEND_VALUE_WSL_OFF}>
                  Off
                </SelectItem>
                {desktopWslState.distros.length === 0 ? (
                  <SelectItem hideIndicator value={BACKEND_VALUE_DEFAULT_WSL}>
                    Default distro
                  </SelectItem>
                ) : (
                  desktopWslState.distros.map((distro) => (
                    <SelectItem hideIndicator key={distro.name} value={distro.name}>
                      {distro.name}
                      {distro.isDefault ? " (default)" : ""}
                    </SelectItem>
                  ))
                )}
              </SelectPopup>
            </Select>
          }
        />
        {desktopWslState.enabled ? (
          <SettingsRow
            title="WSL only"
            description="Run only the WSL backend. T3 Code restarts when this changes."
            className="bg-muted/20 pl-7 sm:pl-8"
            control={
              <Switch
                checked={desktopWslState.wslOnly}
                disabled={isUpdatingWslBackend}
                onCheckedChange={(checked) => handleToggleWslOnly(checked)}
                aria-label="Run WSL only"
              />
            }
          />
        ) : null}
      </>
    );
  };

  const renderAuthorizedClients = () => (
    <>
      {desktopAccessManagementError ? (
        <div className={ITEM_ROW_CLASSNAME}>
          <p className="text-xs text-destructive">{desktopAccessManagementError}</p>
        </div>
      ) : null}
      <PairingClientsList
        isLoading={isLoadingDesktopAccessManagement}
        pairingLinks={desktopPairingLinks}
        clientSessions={desktopClientSessions}
        revokingPairingLinkId={revokingDesktopPairingLinkId}
        revokingClientSessionId={revokingDesktopClientSessionId}
        onRevokePairingLink={handleRevokeDesktopPairingLink}
        onRevokeClientSession={handleRevokeDesktopClientSession}
        canRevoke={canWriteAccess}
      />
    </>
  );
  const primarySettings = (
    <>
      {primaryEnvironmentId !== null ? (
        <>
          <SettingsSection
            {...searchableSetting("connections-environment")}
            title={
              primaryEnvironment?.label ?? (desktopBridge ? "This machine" : "Primary environment")
            }
            icon={
              <EnvironmentMachineIcon
                aria-hidden
                kind={
                  primaryServerConfig
                    ? resolveEnvironmentMachineKind(primaryServerConfig)
                    : "desktop"
                }
                className="size-4"
              />
            }
            headerAction={
              primaryEnvironmentId !== null ? (
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost-muted"
                        size="icon-xs"
                        aria-label="More actions for this machine"
                      />
                    }
                  >
                    <EllipsisIcon className="size-3.5" />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <EnvironmentIconMenu
                      environmentId={primaryEnvironmentId}
                      serverConfig={primaryServerConfig}
                    />
                  </MenuPopup>
                </Menu>
              ) : null
            }
          >
            {canManageLocalBackend ? (
              <SettingsRow
                title="Version"
                description={
                  primaryServerUpdateState.status !== "idle" ? (
                    <ServerUpdateProgress state={primaryServerUpdateState} />
                  ) : (
                    [
                      primaryServerConfig?.environment.serverVersion ?? null,
                      primaryEnvironment?.displayUrl ?? null,
                    ]
                      .filter((value): value is string => value !== null)
                      .join(" · ") || "Loading…"
                  )
                }
                control={
                  primaryVersionMismatch &&
                  primaryEnvironmentId !== null &&
                  primaryServerUpdateState.status !== "running" ? (
                    <ServerUpdateAction
                      size="sm"
                      environmentId={primaryEnvironmentId}
                      serverLabel={
                        primaryEnvironment ? `${primaryEnvironment.label} server` : "server"
                      }
                      selfUpdate={resolveServerSelfUpdateCapability(primaryServerConfig)}
                      installation={
                        primaryServerConfig?.environment.capabilities.serverInstallation
                      }
                      desktopAppUpdate={supportsDesktopAppUpdate(primaryServerConfig)}
                      targetVersion={primaryVersionMismatch.clientVersion}
                      label={
                        primaryServerUpdateState.status === "failed"
                          ? "Retry update"
                          : `Update to ${primaryVersionMismatch.clientVersion}`
                      }
                    />
                  ) : primaryServerUpdateState.status === "idle" && primaryServerConfig ? (
                    <LocalVersionStatusLabel />
                  ) : undefined
                }
              />
            ) : null}
            {canManageLocalBackend && desktopBridge ? renderWslRow() : null}
            {primaryEnvironment ? (
              <details className="group px-3 sm:px-4">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  Permissions
                  <ChevronRightIcon
                    aria-hidden
                    className="size-3 text-muted-foreground group-open:rotate-90"
                  />
                </summary>
                <SessionPermissions
                  environmentId={primaryEnvironment.environmentId}
                  connected={primaryEnvironment.connection.phase === "connected"}
                />
              </details>
            ) : null}
          </SettingsSection>

          {canReadAccess || canWriteAccess ? (
            <FoldedSettingsSection
              id="authorized-clients"
              title="Authorized clients"
              summary={summarizeAuthorizedClients(desktopClientSessions, desktopPairingLinks)}
              control={
                canWriteAccess ? (
                  <AuthorizedClientsHeaderAction
                    clientSessions={
                      canReadAccess &&
                      authAccessChanges.error === null &&
                      authAccessChanges.data?.type === "snapshot"
                        ? desktopClientSessions
                        : null
                    }
                    isRevokingOtherClients={isRevokingOtherDesktopClients}
                    onRevokeOtherClients={handleRevokeOtherDesktopClients}
                  />
                ) : undefined
              }
            >
              <ScrollArea
                scrollFade
                chainVerticalScroll
                className="max-h-[22.5rem]"
                data-testid="authorized-clients-scroll-area"
              >
                {canReadAccess ? (
                  renderAuthorizedClients()
                ) : (
                  <p className="px-4 py-3 text-xs text-muted-foreground">
                    This connection can create access links but cannot view authorized clients.
                  </p>
                )}
              </ScrollArea>
            </FoldedSettingsSection>
          ) : null}
          <AlertDialog
            open={isWslConfirmDialogOpen && canManageLocalBackend}
            onOpenChange={(open) => {
              if (isUpdatingWslBackend) return;
              if (!open) setPendingWslChange(null);
            }}
          >
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {pendingWslChange?.kind === "disable"
                    ? pendingWslChange.wasWslOnly
                      ? "Turn off WSL and switch back to Windows?"
                      : "Disable WSL backend?"
                    : pendingWslChange?.kind === "distro"
                      ? "Switch WSL distro?"
                      : pendingWslChange?.kind === "enable"
                        ? "Start the WSL backend"
                        : pendingWslChange?.nextValue
                          ? "Run only the WSL backend?"
                          : "Re-enable the Windows backend?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {pendingWslChange?.kind === "disable"
                    ? pendingWslChange.wasWslOnly
                      ? "T3 Code will restart on the Windows backend. Threads and projects opened against WSL stay safe inside the distro and become available again when you re-enable WSL."
                      : "The WSL backend will stop. Threads and projects opened against WSL stay safe inside the distro, but they'll be unavailable in T3 Code until you re-enable WSL."
                    : pendingWslChange?.kind === "distro"
                      ? "T3 Code will restart the WSL backend on the new distro. Sessions still running on the current distro will be interrupted."
                      : pendingWslChange?.kind === "enable"
                        ? "Run the WSL backend alongside the Windows one, or stop the Windows backend and use only WSL? You can change this later from Settings."
                        : pendingWslChange?.nextValue
                          ? "T3 Code will restart and start only the WSL backend. Your Windows-side projects won't be accessible until you turn this off again."
                          : "T3 Code will restart and bring the Windows backend back up alongside WSL."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose
                  disabled={isUpdatingWslBackend}
                  render={<Button variant="outline" disabled={isUpdatingWslBackend} />}
                >
                  Cancel
                </AlertDialogClose>
                {pendingWslChange?.kind === "enable" ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => handleConfirmEnableWsl("wsl-only")}
                      disabled={isUpdatingWslBackend || !canManageLocalBackend}
                    >
                      {isUpdatingWslBackend ? (
                        <>
                          <Spinner size="sm" />
                          Applying…
                        </>
                      ) : (
                        "Use only WSL"
                      )}
                    </Button>
                    <Button
                      variant="default"
                      onClick={() => handleConfirmEnableWsl("both")}
                      disabled={isUpdatingWslBackend || !canManageLocalBackend}
                    >
                      {isUpdatingWslBackend ? (
                        <>
                          <Spinner size="sm" />
                          Applying…
                        </>
                      ) : (
                        "Run both backends"
                      )}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant={
                      pendingWslChange?.kind === "disable" ||
                      (pendingWslChange?.kind === "wsl-only" && pendingWslChange.nextValue)
                        ? "destructive"
                        : "default"
                    }
                    onClick={handleConfirmWslChange}
                    disabled={isUpdatingWslBackend || !canManageLocalBackend}
                  >
                    {isUpdatingWslBackend ? (
                      <>
                        <Spinner size="sm" />
                        Applying…
                      </>
                    ) : pendingWslChange?.kind === "disable" ? (
                      pendingWslChange.wasWslOnly ? (
                        "Switch to Windows"
                      ) : (
                        "Disable WSL"
                      )
                    ) : pendingWslChange?.kind === "distro" ? (
                      "Switch distro"
                    ) : pendingWslChange?.nextValue ? (
                      "Restart and enable"
                    ) : (
                      "Restart and disable"
                    )}
                  </Button>
                )}
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        </>
      ) : (
        <SettingsSection {...searchableSetting("connections-environment")}>
          <SettingsRow
            title="No environment selected"
            description="Connect an environment to view its settings and access."
          />
        </SettingsSection>
      )}
    </>
  );

  if (showsAccess) return <SettingsPageContainer>{primarySettings}</SettingsPageContainer>;

  return (
    <SettingsPageContainer>
      {desktopBridge ? (
        <SettingsSection id="this-app" title="This app">
          <LocalEnvironmentSetting />
        </SettingsSection>
      ) : null}
      <LoadBalancingSettings environments={loadBalancingEnvironments} />
      <PullRequestRoutingSettings environments={loadBalancingEnvironments} />
    </SettingsPageContainer>
  );
}
