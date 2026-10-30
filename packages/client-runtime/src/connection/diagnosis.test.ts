import { describe, expect, it } from "@effect/vitest";

import { presentConnectionDiagnosis } from "./diagnosis.ts";
import { mapRemoteEnvironmentError } from "./errors.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  type ConnectionAttemptError,
  ConnectionBlockedError,
  type SupervisorConnectionState,
} from "./model.ts";
import { RemoteEnvironmentAuthFetchError } from "../rpc/http.ts";

const backoff = (lastFailure: ConnectionAttemptError): SupervisorConnectionState => ({
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  network: "online",
  phase: "backoff",
  attempt: 3,
  lastFailure,
  retryAt: Date.UTC(2026, 9, 19, 12, 0, 30),
});

const diagnose = (state: SupervisorConnectionState) =>
  presentConnectionDiagnosis({ hostLabel: "Mac mini", state });

const results = (state: SupervisorConnectionState) =>
  diagnose(state)?.hops.map((hop) => `${hop.hop}:${hop.result}`);

describe("presentConnectionDiagnosis", () => {
  it("returns nothing while no attempt has failed", () => {
    expect(diagnose(AVAILABLE_CONNECTION_STATE)).toBeNull();
  });

  it("blames T3 Code on the host when the request never got an answer", () => {
    const failure = mapRemoteEnvironmentError(
      new RemoteEnvironmentAuthFetchError({ message: "Failed to fetch", cause: new TypeError() }),
    );
    const diagnosis = diagnose(backoff(failure));
    expect(diagnosis?.headline).toBe("T3 Code on Mac mini did not answer");
    expect(results(backoff(failure))).toEqual(["device:ok", "server:failed"]);
    expect(diagnosis?.facts).toContainEqual(["Attempts", "3"]);
    expect(diagnosis?.facts.map(([label]) => label)).not.toContain("HTTP status");
  });

  it("names a refused device apart from a silent host", () => {
    const failure = new ConnectionBlockedError({
      reason: "authentication",
      detail: "The environment credential is invalid.",
      hop: "server",
      httpStatus: 401,
    });
    const diagnosis = diagnose(backoff(failure));
    expect(diagnosis?.headline).toBe("T3 Code on Mac mini did not accept this device");
    expect(diagnosis?.facts).toContainEqual(["HTTP status", "401"]);
  });

  it("stops at this device when the connection could not be prepared", () => {
    const failure = new ConnectionBlockedError({
      reason: "configuration",
      detail: "Connection profile lan is unavailable.",
      hop: "device",
    });
    expect(diagnose(backoff(failure))?.headline).toBe(
      "This device could not prepare the connection",
    );
    expect(results(backoff(failure))).toEqual(["device:failed", "server:unchecked"]);
  });

  it("reports this device as offline before any other hop", () => {
    const failure = mapRemoteEnvironmentError(
      new RemoteEnvironmentAuthFetchError({ message: "Failed to fetch", cause: new TypeError() }),
    );
    const state = { ...backoff(failure), network: "offline" as const };
    expect(diagnose(state)?.headline).toBe("This device is offline");
    expect(results(state)?.[0]).toBe("device:failed");
  });
});
