import { fromLenientJson } from "@t3tools/shared/schemaJson";
import { resolveSymlinkTarget } from "@t3tools/shared/symlink";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import {
  DEFAULT_LINUX_PASSWORD_STORE,
  normalizeLinuxPasswordStorePreference,
  type LinuxPasswordStorePreference,
} from "../linuxSecretStorage.ts";
import { isValidDistroName } from "../wsl/wslPathParsing.ts";

export interface DesktopSettings {
  readonly linuxPasswordStore: LinuxPasswordStorePreference;
  readonly mainWindowBounds: DesktopWindowBounds | null;
  readonly mainWindowMaximized: boolean;
  readonly wslBackendEnabled: boolean;
  readonly wslDistro: string | null;
  // Requires restart because the pool chooses its primary spec at layer initialization.
  readonly wslOnly: boolean;
}

export interface DesktopSettingsChange {
  readonly settings: DesktopSettings;
  readonly changed: boolean;
}

const MIN_MAIN_WINDOW_SIZE = {
  width: 840,
  height: 620,
} as const;
export const DesktopWindowBoundsSchema = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  width: Schema.Int.check(Schema.isGreaterThanOrEqualTo(MIN_MAIN_WINDOW_SIZE.width)),
  height: Schema.Int.check(Schema.isGreaterThanOrEqualTo(MIN_MAIN_WINDOW_SIZE.height)),
});
export type DesktopWindowBounds = typeof DesktopWindowBoundsSchema.Type;
export const DEFAULT_MAIN_WINDOW_SIZE = {
  width: 1100,
  height: 780,
} as const;

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  linuxPasswordStore: DEFAULT_LINUX_PASSWORD_STORE,
  mainWindowBounds: null,
  mainWindowMaximized: false,
  wslBackendEnabled: false,
  wslDistro: null,
  wslOnly: false,
};

const DesktopWindowBoundsDocument = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});

const DesktopSettingsDocument = Schema.Struct({
  linuxPasswordStore: Schema.optionalKey(Schema.Unknown),
  mainWindowBounds: Schema.optionalKey(Schema.NullOr(DesktopWindowBoundsDocument)),
  mainWindowMaximized: Schema.optionalKey(Schema.Boolean),
  wslBackendEnabled: Schema.optionalKey(Schema.Boolean),
  wslMode: Schema.optionalKey(Schema.Literals(["local", "wsl"])),
  wslDistro: Schema.optionalKey(Schema.NullOr(Schema.String)),
  wslOnly: Schema.optionalKey(Schema.Boolean),
});

type DesktopSettingsDocument = typeof DesktopSettingsDocument.Type;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const DesktopSettingsJson = fromLenientJson(DesktopSettingsDocument);
const decodeDesktopSettingsJson = Schema.decodeEffect(DesktopSettingsJson);
const encodeDesktopSettingsJson = Schema.encodeEffect(DesktopSettingsJson);
const decodeDesktopWindowBounds = Schema.decodeUnknownOption(DesktopWindowBoundsSchema);
const desktopWindowBoundsEquivalence = Schema.toEquivalence(DesktopWindowBoundsSchema);

const settingsChange = (settings: DesktopSettings, changed: boolean): DesktopSettingsChange => ({
  settings,
  changed,
});

const DesktopSettingsWriteOperation = Schema.Literals([
  "create-temporary-file-name",
  "resolve-symlink",
  "encode-document",
  "create-directory",
  "write-temporary-file",
  "replace-settings-file",
]);
type DesktopSettingsWriteOperation = typeof DesktopSettingsWriteOperation.Type;

export class DesktopSettingsWriteError extends Schema.TaggedError<DesktopSettingsWriteError>()(
  "DesktopSettingsWriteError",
  {
    operation: DesktopSettingsWriteOperation,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop settings write failed during ${this.operation} at ${this.path}.`;
  }
}

export class DesktopAppSettings extends Context.Service<
  DesktopAppSettings,
  {
    readonly load: Effect.Effect<DesktopSettings>;
    readonly get: Effect.Effect<DesktopSettings>;
    readonly setMainWindowBounds: (
      bounds: DesktopWindowBounds,
      isMaximized: boolean,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setWslBackendEnabled: (
      enabled: boolean,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setWslDistro: (
      distro: string | null,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setWslOnly: (
      enabled: boolean,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly applyWslWindowsFallback: Effect.Effect<
      DesktopSettingsChange,
      DesktopSettingsWriteError
    >;
    readonly applyWslWindowsFallbackInMemory: Effect.Effect<DesktopSettingsChange>;
  }
>()("@t3tools/desktop/settings/DesktopAppSettings") {}

function normalizeWslDistro(value: unknown): string | null {
  return typeof value === "string" && isValidDistroName(value) ? value : null;
}

export function normalizeMainWindowBounds(value: unknown): DesktopWindowBounds | null {
  return Option.getOrNull(decodeDesktopWindowBounds(value));
}

function normalizeDesktopSettingsDocument(parsed: DesktopSettingsDocument): DesktopSettings {
  const mainWindowBounds = normalizeMainWindowBounds(parsed.mainWindowBounds);

  const wslBackendEnabled =
    parsed.wslBackendEnabled === true ||
    (parsed.wslBackendEnabled === undefined && parsed.wslMode === "wsl");

  return {
    linuxPasswordStore: normalizeLinuxPasswordStorePreference(parsed.linuxPasswordStore),
    mainWindowBounds,
    mainWindowMaximized: mainWindowBounds !== null && parsed.mainWindowMaximized === true,
    wslBackendEnabled,
    wslDistro: normalizeWslDistro(parsed.wslDistro),
    wslOnly: parsed.wslOnly === true,
  };
}

function toDesktopSettingsDocument(
  settings: DesktopSettings,
  defaults: DesktopSettings,
): DesktopSettingsDocument {
  const document: Mutable<DesktopSettingsDocument> = {};

  if (settings.linuxPasswordStore !== defaults.linuxPasswordStore) {
    document.linuxPasswordStore = settings.linuxPasswordStore;
  }
  if (settings.mainWindowBounds !== null) {
    document.mainWindowBounds = settings.mainWindowBounds;
  }
  if (settings.mainWindowMaximized) {
    document.mainWindowMaximized = true;
  }
  if (settings.wslBackendEnabled !== defaults.wslBackendEnabled) {
    document.wslBackendEnabled = settings.wslBackendEnabled;
  }
  if (settings.wslDistro !== defaults.wslDistro) {
    document.wslDistro = settings.wslDistro;
  }
  if (settings.wslOnly !== defaults.wslOnly) {
    document.wslOnly = settings.wslOnly;
  }

  return document;
}

function setMainWindowBounds(
  settings: DesktopSettings,
  bounds: DesktopWindowBounds,
  isMaximized: boolean,
): DesktopSettings {
  return settings.mainWindowBounds !== null &&
    desktopWindowBoundsEquivalence(settings.mainWindowBounds, bounds) &&
    settings.mainWindowMaximized === isMaximized
    ? settings
    : {
        ...settings,
        mainWindowBounds: bounds,
        mainWindowMaximized: isMaximized,
      };
}

function setWslBackendEnabled(settings: DesktopSettings, enabled: boolean): DesktopSettings {
  return settings.wslBackendEnabled === enabled
    ? settings
    : {
        ...settings,
        wslBackendEnabled: enabled,
      };
}

function setWslDistro(settings: DesktopSettings, distro: string | null): DesktopSettings {
  const normalized = normalizeWslDistro(distro);
  return settings.wslDistro === normalized
    ? settings
    : {
        ...settings,
        wslDistro: normalized,
      };
}

function setWslOnly(settings: DesktopSettings, enabled: boolean): DesktopSettings {
  return settings.wslOnly === enabled
    ? settings
    : {
        ...settings,
        wslOnly: enabled,
      };
}

function applyWslWindowsFallback(settings: DesktopSettings): DesktopSettings {
  return setWslOnly(setWslBackendEnabled(settings, false), false);
}

function readSettings(
  fileSystem: FileSystem.FileSystem,
  settingsPath: string,
): Effect.Effect<DesktopSettings> {
  const defaultSettings = DEFAULT_DESKTOP_SETTINGS;

  return fileSystem.readFileString(settingsPath).pipe(
    Effect.option,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(defaultSettings),
        onSome: (raw) =>
          decodeDesktopSettingsJson(raw).pipe(
            Effect.map(normalizeDesktopSettingsDocument),
            Effect.orElseSucceed(() => defaultSettings),
          ),
      }),
    ),
  );
}

const writeSettings = Effect.fn("desktop.settings.writeSettings")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly settingsPath: string;
  readonly settings: DesktopSettings;
  readonly defaultSettings: DesktopSettings;
  readonly suffix: string;
}): Effect.fn.Return<void, DesktopSettingsWriteError> {
  const targetPath = yield* resolveSymlinkTarget(input.settingsPath).pipe(
    Effect.provideService(FileSystem.FileSystem, input.fileSystem),
    Effect.provideService(Path.Path, input.path),
    Effect.mapError(
      (cause) =>
        new DesktopSettingsWriteError({
          operation: "resolve-symlink",
          path: input.settingsPath,
          cause,
        }),
    ),
  );
  const directory = input.path.dirname(targetPath);
  const tempPath = `${targetPath}.${process.pid}.${input.suffix}.tmp`;
  const encoded = yield* encodeDesktopSettingsJson(
    toDesktopSettingsDocument(input.settings, input.defaultSettings),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopSettingsWriteError({
          operation: "encode-document",
          path: input.settingsPath,
          cause,
        }),
    ),
  );
  yield* input.fileSystem.makeDirectory(directory, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopSettingsWriteError({
          operation: "create-directory",
          path: directory,
          cause,
        }),
    ),
  );
  yield* input.fileSystem.writeFileString(tempPath, `${encoded}\n`).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopSettingsWriteError({
          operation: "write-temporary-file",
          path: tempPath,
          cause,
        }),
    ),
  );
  yield* input.fileSystem.rename(tempPath, targetPath).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopSettingsWriteError({
          operation: "replace-settings-file",
          path: input.settingsPath,
          cause,
        }),
    ),
  );
});

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const settingsRef = yield* SynchronizedRef.make(environment.defaultDesktopSettings);

  const updateInMemory = (update: (settings: DesktopSettings) => DesktopSettings) =>
    SynchronizedRef.modify(settingsRef, (settings) => {
      const nextSettings = update(settings);
      return [settingsChange(nextSettings, nextSettings !== settings), nextSettings] as const;
    });

  const persist = (
    update: (settings: DesktopSettings) => DesktopSettings,
  ): Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError> =>
    SynchronizedRef.modifyEffect(settingsRef, (settings) => {
      const nextSettings = update(settings);
      if (nextSettings === settings) {
        return Effect.succeed([settingsChange(settings, false), settings] as const);
      }

      return crypto.randomUUIDv4().pipe(
        Effect.map((uuid) => uuid.replace(/-/g, "")),
        Effect.mapError(
          (cause) =>
            new DesktopSettingsWriteError({
              operation: "create-temporary-file-name",
              path: environment.desktopSettingsPath,
              cause,
            }),
        ),
        Effect.flatMap((suffix) =>
          writeSettings({
            fileSystem,
            path,
            settingsPath: environment.desktopSettingsPath,
            settings: nextSettings,
            defaultSettings: environment.defaultDesktopSettings,
            suffix,
          }),
        ),
        Effect.as([settingsChange(nextSettings, true), nextSettings] as const),
      );
    });

  return DesktopAppSettings.of({
    get: SynchronizedRef.get(settingsRef),
    load: Effect.gen(function* () {
      const settings = yield* readSettings(fileSystem, environment.desktopSettingsPath);
      return yield* SynchronizedRef.setAndGet(settingsRef, settings);
    }).pipe(Effect.withSpan("desktop.settings.load")),
    setMainWindowBounds: Effect.fn("desktop.settings.setMainWindowBounds")(
      function* (bounds, isMaximized) {
        yield* Effect.annotateCurrentSpan({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          isMaximized,
        });

        return yield* persist((settings) => setMainWindowBounds(settings, bounds, isMaximized));
      },
    ),
    setWslBackendEnabled: Effect.fn("desktop.settings.setWslBackendEnabled")(function* (enabled) {
      yield* Effect.annotateCurrentSpan({ enabled });

      return yield* persist((settings) => setWslBackendEnabled(settings, enabled));
    }),
    setWslDistro: Effect.fn("desktop.settings.setWslDistro")(function* (distro) {
      yield* Effect.annotateCurrentSpan({ distro: distro ?? null });

      return yield* persist((settings) => setWslDistro(settings, distro));
    }),
    setWslOnly: Effect.fn("desktop.settings.setWslOnly")(function* (enabled) {
      yield* Effect.annotateCurrentSpan({ enabled });

      return yield* persist((settings) => setWslOnly(settings, enabled));
    }),
    applyWslWindowsFallback: persist(applyWslWindowsFallback).pipe(
      Effect.withSpan("desktop.settings.applyWslWindowsFallback"),
    ),
    applyWslWindowsFallbackInMemory: updateInMemory(applyWslWindowsFallback).pipe(
      Effect.withSpan("desktop.settings.applyWslWindowsFallbackInMemory"),
    ),
  });
});

export const layer = Layer.effect(DesktopAppSettings, make);

export const layerTest = (initialSettings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS) =>
  Layer.effect(
    DesktopAppSettings,
    Effect.gen(function* () {
      const settingsRef = yield* SynchronizedRef.make(initialSettings);
      const update = (f: (settings: DesktopSettings) => DesktopSettings) =>
        SynchronizedRef.modify(settingsRef, (settings) => {
          const nextSettings = f(settings);
          return [
            {
              settings: nextSettings,
              changed: nextSettings !== settings,
            },
            nextSettings,
          ] as const;
        });

      return DesktopAppSettings.of({
        get: SynchronizedRef.get(settingsRef),
        load: SynchronizedRef.get(settingsRef),
        setMainWindowBounds: Effect.fn("DesktopAppSettings.setMainWindowBounds")(
          function (bounds, isMaximized) {
            return update((settings) => setMainWindowBounds(settings, bounds, isMaximized));
          },
        ),
        setWslBackendEnabled: Effect.fn("DesktopAppSettings.setWslBackendEnabled")(
          function (enabled) {
            return update((settings) => setWslBackendEnabled(settings, enabled));
          },
        ),
        setWslDistro: Effect.fn("DesktopAppSettings.setWslDistro")(function (distro) {
          return update((settings) => setWslDistro(settings, distro));
        }),
        setWslOnly: Effect.fn("DesktopAppSettings.setWslOnly")(function (enabled) {
          return update((settings) => setWslOnly(settings, enabled));
        }),
        applyWslWindowsFallback: update(applyWslWindowsFallback),
        applyWslWindowsFallbackInMemory: update(applyWslWindowsFallback),
      });
    }),
  );
