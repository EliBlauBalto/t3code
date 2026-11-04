import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { vi } from "vite-plus/test";
import { ProviderInstanceId } from "@t3tools/contracts";
import { RegistryContext, useAtomSet } from "@effect/atom-react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("../lib/runtime", async () => {
  const Layer = await import("effect/Layer");
  return {
    runtime: { runPromise: vi.fn() },
    layer: Layer.empty,
  };
});

import { createMobilePreferencesState } from "./preferences";
import * as MobilePreferences from "../persistence/mobile-preferences";
import * as MobileDatabase from "../persistence/mobile-database";
import * as MobileSecureStorage from "../persistence/mobile-secure-storage";
import { normalizeDreamPreferences } from "../lib/dreamDashboard";

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((resume) => {
    resolve = resume;
  });
  return { promise, resolve } as const;
}

function makePreferencesState(
  service: Omit<MobilePreferences.MobilePreferencesStore["Service"], "update"> &
    Partial<Pick<MobilePreferences.MobilePreferencesStore["Service"], "update">>,
) {
  const completeService = MobilePreferences.MobilePreferencesStore.of({
    ...service,
    update:
      service.update ??
      ((transform) =>
        service.load.pipe(
          Effect.flatMap((current) => service.savePatch(transform(current))),
          Effect.mapError((cause) =>
            cause._tag === "MobilePreferencesSaveError"
              ? cause
              : new MobilePreferences.MobilePreferencesSaveError({ cause }),
          ),
        )),
  });
  return createMobilePreferencesState(
    Atom.runtime(Layer.succeed(MobilePreferences.MobilePreferencesStore, completeService)),
  );
}

describe("mobile preferences state", () => {
  it.effect(
    "keeps Dream slots and selected scope after saving and loading the existing preference store",
    () =>
      Effect.gen(function* () {
        let stored: MobileDatabase.StoredPreferencesJson | null = null;
        const database = MobileDatabase.MobileDatabase.of({
          loadCache: () => Effect.succeed(Option.none()),
          listCache: () => Effect.succeed([]),
          saveCache: () => Effect.void,
          removeCache: () => Effect.void,
          clearCacheKind: () => Effect.void,
          clearEnvironmentCache: () => Effect.void,
          clearAllCaches: Effect.void,
          inspectCaches: Effect.succeed([]),
          loadPreferencesJson: Effect.sync(() => Option.fromNullishOr(stored)),
          savePreferencesJson: (payload, updatedAt) =>
            Effect.sync(() => {
              stored = { payload, updatedAt };
            }),
        });
        const secureStorage = MobileSecureStorage.MobileSecureStorage.of({
          getItem: () => Effect.succeed(null),
          setItem: () => Effect.void,
          removeItem: () => Effect.void,
        });
        const layer = MobilePreferences.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(MobileDatabase.MobileDatabase, database),
              Layer.succeed(MobileSecureStorage.MobileSecureStorage, secureStorage),
            ),
          ),
        );
        const preferences = normalizeDreamPreferences({
          all: false,
          projects: ["env:project"],
          threads: ["env:thread"],
          slots: ["cost", "", "status", "limits", "tokens"],
          monochrome: true,
        });
        const result = yield* Effect.gen(function* () {
          const store = yield* MobilePreferences.MobilePreferencesStore;
          yield* store.savePatch({ dreamDashboard: preferences, baseFontSize: 18 });
          return yield* store.load;
        }).pipe(Effect.provide(layer));
        expect(result.dreamDashboard).toEqual(preferences);
        expect(result.baseFontSize).toBe(18);
      }),
  );
  it.effect("preserves an optimistic patch when the initial load finishes later", () =>
    Effect.gen(function* () {
      const pendingLoad = deferred<MobilePreferences.Preferences>();
      const savePatch = vi.fn((patch: Partial<MobilePreferences.Preferences>) =>
        Effect.succeed(patch),
      );
      const state = makePreferencesState({
        load: Effect.promise(() => pendingLoad.promise),
        savePatch,
      });
      const registry = AtomRegistry.make();
      const unmountPreferences = registry.mount(state.preferencesAtom);
      const unmountUpdate = registry.mount(state.updatePreferencesAtom);

      registry.set(state.updatePreferencesAtom, {
        collapsedProjectGroups: ["project:new"],
      });
      pendingLoad.resolve({
        baseFontSize: 18,
        collapsedProjectGroups: ["project:old"],
      });

      const preferences = yield* AtomRegistry.getResult(registry, state.preferencesAtom, {
        suspendOnWaiting: true,
      });
      expect(preferences).toEqual({
        baseFontSize: 18,
        collapsedProjectGroups: ["project:new"],
      });
      expect(savePatch).toHaveBeenCalledWith({
        collapsedProjectGroups: ["project:new"],
      });
      expect(AsyncResult.isFailure(registry.get(state.updatePreferencesAtom))).toBe(false);

      unmountUpdate();
      unmountPreferences();
      registry.dispose();
    }),
  );

  it.effect("keeps both favorites when the React setter sends updates before a render", () =>
    Effect.gen(function* () {
      let persisted: MobilePreferences.Preferences = { modelFavorites: [] };
      const state = makePreferencesState({
        load: Effect.succeed(persisted),
        savePatch: (patch) =>
          Effect.sync(() => {
            persisted = { ...persisted, ...patch };
            return persisted;
          }),
        update: (transform) =>
          Effect.sync(() => {
            persisted = { ...persisted, ...transform(persisted) };
            return persisted;
          }),
      });
      const registry = AtomRegistry.make();
      const unmountPreferences = registry.mount(state.preferencesAtom);
      const unmountUpdate = registry.mount(state.updatePreferencesAtom);
      yield* AtomRegistry.getResult(registry, state.preferencesAtom, { suspendOnWaiting: true });

      function useSavePreferences() {
        return useAtomSet(state.updatePreferencesAtom);
      }
      const setters: Array<ReturnType<typeof useSavePreferences>> = [];
      function CaptureSetter() {
        setters.push(useSavePreferences());
        return null;
      }
      // Use the React setter; registry.set bypasses bare-function update semantics.
      renderToString(
        createElement(RegistryContext.Provider, { value: registry }, createElement(CaptureSetter)),
      );
      const savePreferences = setters[0]!;
      const provider = ProviderInstanceId.make("codex");
      savePreferences({
        transform: (current) => ({
          modelFavorites: [...(current.modelFavorites ?? []), { provider, model: "astra" }],
        }),
      });
      savePreferences({
        transform: (current) => ({
          modelFavorites: [...(current.modelFavorites ?? []), { provider, model: "sol" }],
        }),
      });
      yield* AtomRegistry.getResult(registry, state.updatePreferencesAtom, {
        suspendOnWaiting: true,
      });

      expect(persisted.modelFavorites).toEqual([
        { provider, model: "astra" },
        { provider, model: "sol" },
      ]);

      savePreferences({
        transform: (current) => ({
          modelFavorites: (current.modelFavorites ?? []).filter(
            (favorite) => favorite.model !== "astra",
          ),
        }),
      });
      yield* AtomRegistry.getResult(registry, state.updatePreferencesAtom, {
        suspendOnWaiting: true,
      });
      expect(persisted.modelFavorites).toEqual([{ provider, model: "sol" }]);

      unmountUpdate();
      unmountPreferences();
      registry.dispose();
    }),
  );

  it.effect("falls back to empty preferences when secure storage cannot be read", () =>
    Effect.gen(function* () {
      const state = makePreferencesState({
        load: Effect.fail(
          new MobilePreferences.MobilePreferencesLoadError({
            cause: new Error("secure storage unavailable"),
          }),
        ),
        savePatch: (patch) => Effect.succeed(patch),
      });
      const registry = AtomRegistry.make();
      const unmount = registry.mount(state.preferencesAtom);

      expect(
        yield* AtomRegistry.getResult(registry, state.preferencesAtom, {
          suspendOnWaiting: true,
        }),
      ).toEqual({});

      unmount();
      registry.dispose();
    }),
  );
});
