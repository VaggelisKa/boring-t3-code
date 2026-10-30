// @effect-diagnostics nodeBuiltinImport:off - the suite seeds and grows real
// transcript trees on disk, outside the service's Effect FileSystem.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { assert, describe, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  UsageDay,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scheduler from "effect/Scheduler";
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as AntigravityUsage from "../provider/Drivers/AntigravityUsage.ts";
import * as ProviderHostLive from "../provider/ProviderHostLive.ts";
import * as UsageService from "./UsageService.ts";

vi.mock("node:fs/promises", { spy: true });
const WINDOW: UsageSummaryInput = {
  timeZone: "UTC",
  sinceDay: UsageDay.make("2026-07-31"),
  untilDay: UsageDay.make("2026-08-02"),
};

const setup = Effect.gen(function* () {
  const home = yield* Effect.promise(() =>
    NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-service-test-")),
  );
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true })),
  );
  const transcriptDir = NodePath.join(home, "claude", "projects", "proj");
  yield* Effect.promise(() => NodeFSP.mkdir(transcriptDir, { recursive: true }));
  return {
    home,
    transcript: NodePath.join(transcriptDir, "session.jsonl"),
    settings: {
      providerInstances: {
        [ProviderInstanceId.make("claudeAgent")]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          config: { homePath: NodePath.join(home, "claude") },
        },
        [ProviderInstanceId.make("codex")]: {
          driver: ProviderDriverKind.make("codex"),
          config: { homePath: NodePath.join(home, "codex") },
        },
      },
    },
  };
});

const layerService = (input: {
  readonly prefix: string;
  readonly home: string;
  readonly settings: Parameters<typeof ServerSettings.layerTest>[0];
  readonly onRatesFetch?: (request: HttpClientRequest.HttpClientRequest) => void;
  readonly ratesDocument?: unknown;
  readonly ratesStatus?: () => number;
  readonly ratesResponse?: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<Response, HttpClientError.HttpClientError>;
  readonly environment?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly hostname?: string;
}) =>
  AntigravityUsage.layer.pipe(
    Layer.provideMerge(ProviderHostLive.layer),
    Layer.provideMerge(Layer.mock(BackgroundPolicy.BackgroundPolicy)({})),
    Layer.provideMerge(Layer.mock(ServerSecretStore.ServerSecretStore)({})),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), NodePath.join(input.home, input.prefix)),
    ),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(Layer.succeed(HostProcess.Platform, input.platform ?? "linux")),
    Layer.provideMerge(Layer.succeed(HostProcess.Hostname, input.hostname ?? "usage-test-host")),
    Layer.provideMerge(ServerSettings.layerTest(input.settings)),
    Layer.provideMerge(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.suspend(() => {
            input.onRatesFetch?.(request);
            const response = input.ratesResponse
              ? input.ratesResponse(request)
              : Effect.succeed(
                  Response.json(input.ratesDocument ?? {}, {
                    status: input.ratesStatus?.() ?? 200,
                  }),
                );
            return response.pipe(
              Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
            );
          }),
        ),
      ),
    ),
    Layer.provideMerge(
      Layer.succeed(HostProcess.Environment, {
        HOME: input.home,
        ANTIGRAVITY_DATA_DIR: NodePath.join(input.home, "antigravity"),
        XDG_CONFIG_HOME: NodePath.join(input.home, "config"),
        APPDATA: NodePath.join(input.home, "config"),
        ...input.environment,
      }),
    ),
  );

// Each waiting gate holds a libuv thread; allow at most three.
describe("UsageService", () => {
  it.live("reads Antigravity history from each instance's data directory", () =>
    Effect.gen(function* () {
      const { settings, home } = yield* setup;
      const first = NodePath.join(home, "antigravity-first");
      const second = NodePath.join(home, "antigravity-second");
      yield* Effect.promise(async () => {
        for (const [dir, outputTokens] of [
          [first, 7],
          [second, 11],
        ] as const) {
          await NodeFSP.mkdir(dir);
          const db = new NodeSqlite.DatabaseSync(
            NodePath.join(dir, `${NodePath.basename(dir)}.db`),
          );
          try {
            db.exec("CREATE TABLE steps (idx INTEGER, metadata BLOB)");
            // Step protobuf: 100 input tokens, distinct output tokens, and 2026-08-01T10:00Z.
            const metadata = new Uint8Array([
              0x4a,
              4,
              0x10,
              100,
              0x18,
              outputTokens,
              ...Buffer.from("420608a087b7d306", "hex"),
            ]);
            db.prepare("INSERT INTO steps VALUES (?, ?)").run(0, metadata);
          } finally {
            db.close();
          }
        }
      });
      const instance = (dataDir: string) => ({
        driver: ProviderDriverKind.make("antigravity"),
        environment: [{ name: "ANTIGRAVITY_DATA_DIR", value: dataDir, sensitive: false }],
      });
      const service = yield* UsageService.make.pipe(
        Effect.provide(
          layerService({
            prefix: "usage-service-antigravity-instances-test",
            home,
            settings: {
              providerInstances: {
                ...settings.providerInstances,
                [ProviderInstanceId.make("antigravity-first")]: instance(first),
                [ProviderInstanceId.make("antigravity-second")]: instance(` ${second}, `),
              },
            },
          }),
        ),
      );
      const summary = yield* service.readSummary(WINDOW);
      const roots = summary.sources
        .filter((source) => source.fingerprint.provider === "antigravity")
        .map((source) => source.fingerprint.resolvedHomePath);
      for (const [dir, outputTokens] of [
        [first, 7],
        [second, 11],
      ] as const) {
        const root = yield* Effect.promise(() => NodeFSP.realpath(dir));
        assert.include(roots, root);
        assert.strictEqual(
          summary.buckets
            .filter((bucket) => bucket.provider === "antigravity" && bucket.sourcePath === root)
            .reduce((sum, bucket) => sum + bucket.totals.outputTokens, 0),
          outputTokens,
        );
      }
    }).pipe(Effect.scoped),
  );

  it.live("does not orphan an in-flight scan when its first caller is interrupted", () =>
    Effect.gen(function* () {
      const { settings, home } = yield* setup;
      const service = yield* UsageService.make.pipe(
        Effect.provide(layerService({ prefix: "usage-service-interruption-test", home, settings })),
      );

      let orphanedAt: number | undefined;
      // oxlint-disable-next-line t3code/no-polling-loop-in-tests -- Fixed-count scheduler interruption matrix; each iteration exercises a different interruption point.
      for (let interruptAt = 1; interruptAt <= 31; interruptAt += 1) {
        const tasks: Array<() => void> = [];
        const dispatcher: Scheduler.SchedulerDispatcher = {
          scheduleTask: (task) => tasks.push(task),
          flush: () => {
            let task: (() => void) | undefined;
            while ((task = tasks.shift()) !== undefined) task();
          },
        };

        let requestFiber: Fiber.Fiber<unknown, unknown> | undefined;
        let requestChecks = 0;
        const scheduler: Scheduler.Scheduler = {
          executionMode: "async",
          makeDispatcher: () => dispatcher,
          shouldYield: (fiber) => {
            if (fiber !== requestFiber) return false;
            requestChecks += 1;
            if (requestChecks !== interruptAt) return false;
            fiber.interruptUnsafe();
            return true;
          },
        };

        const input: UsageSummaryInput = {
          ...WINDOW,
          sinceDay: UsageDay.make("2026-09-01"),
          untilDay: UsageDay.make(`2026-08-${String(interruptAt).padStart(2, "0")}`),
        };
        const first = yield* service
          .readSummary(input)
          .pipe(
            Effect.exit,
            Effect.provideService(Scheduler.Scheduler, scheduler),
            Effect.forkChild,
          );
        requestFiber = first;
        yield* Effect.yieldNow;
        dispatcher.flush();

        const second = yield* service.readSummary(input).pipe(
          Effect.match({
            onFailure: (error) => error.reason,
            onSuccess: () => "success" as const,
          }),
          Effect.provideService(Scheduler.Scheduler, scheduler),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        dispatcher.flush();
        const secondExit = second.pollUnsafe();
        if (secondExit === undefined) {
          second.interruptUnsafe();
          orphanedAt = interruptAt;
          break;
        }
        if (Exit.isFailure(secondExit)) {
          assert.fail("the matching request fiber was interrupted");
        }
        assert.strictEqual(secondExit.value, "invalidWindow");
      }

      assert.isUndefined(
        orphanedAt,
        `interruption left the next matching request pending at scheduler check ${orphanedAt}`,
      );
    }).pipe(Effect.scoped),
  );
});
