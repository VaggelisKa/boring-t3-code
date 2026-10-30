import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

const DESKTOP_LOOPBACK_HOST = "127.0.0.1";

export interface DesktopServerExposureBackendConfig {
  readonly port: number;
  readonly bindHost: string;
  readonly httpBaseUrl: URL;
}

const backendConfigForPort = (port: number): DesktopServerExposureBackendConfig => ({
  port,
  bindHost: DESKTOP_LOOPBACK_HOST,
  httpBaseUrl: new URL(`http://${DESKTOP_LOOPBACK_HOST}:${port}`),
});

/** The desktop backend listens only on loopback; this holds the port it was given. */
export class DesktopServerExposure extends Context.Service<
  DesktopServerExposure,
  {
    readonly backendConfig: Effect.Effect<DesktopServerExposureBackendConfig>;
    readonly configure: (input: {
      readonly port: number;
    }) => Effect.Effect<DesktopServerExposureBackendConfig>;
  }
>()("@t3tools/desktop/backend/DesktopServerExposure") {}

const make = Effect.gen(function* () {
  const configRef = yield* Ref.make(backendConfigForPort(0));
  return DesktopServerExposure.of({
    backendConfig: Ref.get(configRef),
    configure: Effect.fn("desktop.serverExposure.configure")(function* ({ port }) {
      yield* Effect.annotateCurrentSpan({ port });
      const config = backendConfigForPort(port);
      yield* Ref.set(configRef, config);
      return config;
    }),
  });
});

export const layer = Layer.effect(DesktopServerExposure, make);
