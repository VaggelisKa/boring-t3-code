import { useAtomValue } from "@effect/atom-react";
import {
  AVAILABLE_CONNECTION_STATE,
  connectionRoutes,
  hasRelayRoute,
  presentConnectionDiagnosis,
} from "@t3tools/client-runtime/connection";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { APP_VERSION } from "~/branding";
import { environmentCatalog } from "~/connection/catalog";
import { type EnvironmentPresentation, useRelayEnvironmentDiscovery } from "~/state/environments";

/**
 * What failed on the way to an environment, or null while it is connected, off,
 * or has not failed. Reads the supervisor state itself so callers that only need
 * the headline do not re-render on every attempt.
 */
function useConnectionDiagnosis(environment: EnvironmentPresentation) {
  const environmentId = environment.environmentId;
  const state = AsyncResult.getOrElse(
    useAtomValue(environmentCatalog.stateAtom(environmentId)),
    () => AVAILABLE_CONNECTION_STATE,
  );
  const relayStatus = useRelayEnvironmentDiscovery().environments.get(environmentId)?.status;
  const routes = connectionRoutes(environment.entry);
  const relayOnly = routes.length === 1 && hasRelayRoute(environment.entry);
  const phase = environment.connection.phase;
  const diagnosis =
    environment.entry.enabled && phase !== "connected" && phase !== "unsupported"
      ? presentConnectionDiagnosis({
          hostLabel: environment.label,
          state,
          via: relayOnly ? "relay" : "direct",
          // With a direct route as well, the relay's health says nothing about the route in use.
          relayStatus: relayOnly ? Option.getOrNull(relayStatus ?? Option.none()) : null,
          clientVersion: APP_VERSION,
          serverVersion: environment.serverConfig?.environment.serverVersion,
        })
      : null;
  return { diagnosis, state, relayOnly };
}

/** The failure headline alone, for banners outside Settings. */
export function ConnectionDiagnosisHeadline({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  return useConnectionDiagnosis(environment).diagnosis?.headline ?? null;
}
