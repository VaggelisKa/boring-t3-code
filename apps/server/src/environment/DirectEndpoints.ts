import type { ServerDirectEndpoint } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";

import * as ServerConfig from "../config.ts";
import {
  formatHostForUrl,
  isLoopbackHost,
  isPrivateNetworkAddress,
  isWildcardHost,
  VIRTUAL_INTERFACE,
} from "../startupAccess.ts";

type NetworkInterfacesMap = ReturnType<typeof NodeOS.networkInterfaces>;

export class DirectEndpoints extends Context.Service<
  DirectEndpoints,
  {
    readonly resolve: () => Effect.Effect<ReadonlyArray<ServerDirectEndpoint>>;
  }
>()("t3/environment/DirectEndpoints") {}

// Credentials travel over HTTP; public IPs leak them and hostnames can resolve differently per client.
const isAdvertisableAddress = (address: string): boolean =>
  NodeNet.isIPv4(address) && !address.startsWith("127.") && isPrivateNetworkAddress(address);

export function resolveBoundEndpoints(input: {
  readonly host: string | undefined;
  readonly port: number;
  readonly interfaces: NetworkInterfacesMap;
}): ReadonlyArray<ServerDirectEndpoint> {
  if (isLoopbackHost(input.host)) return [];
  const addresses = isWildcardHost(input.host)
    ? Object.entries(input.interfaces)
        .flatMap(([name, entries]) => (VIRTUAL_INTERFACE.test(name) ? [] : (entries ?? [])))
        .filter(
          (entry) =>
            !entry.internal && entry.family === "IPv4" && isAdvertisableAddress(entry.address),
        )
        .map((entry) => entry.address)
    : [input.host!].filter(isAdvertisableAddress);
  return [...new Set(addresses)].map((address) => ({
    kind: "lan",
    httpBaseUrl: `http://${formatHostForUrl(address)}:${input.port}/`,
  }));
}

/** @public */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  return DirectEndpoints.of({
    resolve: Effect.fn("DirectEndpoints.resolve")(function () {
      return Effect.sync(() =>
        resolveBoundEndpoints({
          host: config.host,
          port: config.port,
          interfaces: NodeOS.networkInterfaces(),
        }),
      );
    }),
  });
});

export const layer = Layer.effect(DirectEndpoints, make);
