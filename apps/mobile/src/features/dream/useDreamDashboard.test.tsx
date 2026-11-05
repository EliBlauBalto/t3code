import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import * as Effect from "effect/Effect";
import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import type { Preferences } from "../../persistence/mobile-preferences";

const storage = vi.hoisted(() => ({ preferences: {} as Preferences }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("../../lib/runtime", async () => ({ layer: (await import("effect/Layer")).empty }));
vi.mock("../../connection/catalog", async () => ({
  environmentCatalog: {
    catalogValueAtom: (await import("effect/reactivity")).Atom.make({ isReady: true }),
  },
}));
vi.mock("../../state/presentation", async () => ({
  environmentPresentations: {
    presentationsWithProvidersAtom: (await import("effect/reactivity")).Atom.make(
      new Map([
        [
          "env",
          {
            entry: { enabled: true, target: { label: "Fixture" } },
            connection: { phase: "connected" },
          },
        ],
      ]),
    ),
  },
}));
vi.mock("../../state/shell", async () => {
  const { Atom } = await import("effect/reactivity");
  const Option = await import("effect/Option");
  return {
    environmentShell: {
      stateValueAtom: () => Atom.make({ status: "live", snapshot: Option.some({ projects: [] }) }),
    },
  };
});
vi.mock("../../state/threads", async () => ({
  environmentThreadShells: {
    navigationThreadShellsAtom: (await import("effect/reactivity")).Atom.make([]),
  },
}));
vi.mock("../../state/preferences", async (importOriginal) => {
  const { createMobilePreferencesState } =
    await importOriginal<typeof import("../../state/preferences")>();
  const { MobilePreferencesStore } = await import("../../persistence/mobile-preferences");
  const { Atom } = await import("effect/reactivity");
  const Layer = await import("effect/Layer");
  const Effect = await import("effect/Effect");
  const update = (transform: (current: Preferences) => Partial<Preferences>) =>
    Effect.sync(() => {
      storage.preferences = { ...storage.preferences, ...transform(storage.preferences) };
      return storage.preferences;
    });
  const state = createMobilePreferencesState(
    Atom.runtime(
      Layer.succeed(MobilePreferencesStore, {
        load: Effect.sync(() => storage.preferences),
        update,
        savePatch: (patch) => update(() => patch),
      }),
    ),
  );
  return {
    mobilePreferencesAtom: state.preferencesAtom,
    updateMobilePreferencesAtom: state.updatePreferencesAtom,
  };
});

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { normalizeDreamPreferences } from "../../lib/dreamDashboard";
import { useDreamSources } from "./useDreamDashboard";

it.effect("preserves separate Dream setting changes submitted before the next render", () =>
  Effect.gen(function* () {
    storage.preferences = {
      baseFontSize: 18,
      dreamDashboard: normalizeDreamPreferences(undefined),
    };
    const registry = AtomRegistry.make();
    const unmount = registry.mount(mobilePreferencesAtom);
    const unmountUpdate = registry.mount(updateMobilePreferencesAtom);
    const sources: Array<ReturnType<typeof useDreamSources>> = [];
    function CaptureSources() {
      sources.push(useDreamSources());
      return null;
    }
    try {
      yield* AtomRegistry.getResult(registry, mobilePreferencesAtom, { suspendOnWaiting: true });
      renderToString(
        createElement(RegistryContext.Provider, { value: registry }, createElement(CaptureSources)),
      );
      sources[0]!.save({ palette: "mono" });
      sources[0]!.save({ all: false });
      yield* AtomRegistry.getResult(registry, updateMobilePreferencesAtom, {
        suspendOnWaiting: true,
      });
      expect(storage.preferences).toMatchObject({
        baseFontSize: 18,
        dreamDashboard: {
          all: false,
          palette: "mono",
          slots: ["status", "tokens", "cost", "limits", "working"],
        },
      });
      sources[0]!.save((current) => ({ projects: [...current.projects, "one:p"] }));
      sources[0]!.save((current) => ({ projects: [...current.projects, "two:p"] }));
      yield* AtomRegistry.getResult(registry, updateMobilePreferencesAtom, {
        suspendOnWaiting: true,
      });
      expect(storage.preferences.dreamDashboard).toMatchObject({
        all: false,
        palette: "mono",
        projects: ["one:p", "two:p"],
      });
      sources[0]!.save({ projects: [], threads: ["env:archived"] });
      yield* AtomRegistry.getResult(registry, updateMobilePreferencesAtom, {
        suspendOnWaiting: true,
      });
      renderToString(
        createElement(RegistryContext.Provider, { value: registry }, createElement(CaptureSources)),
      );
      expect([...sources.at(-1)!.environmentIds]).toEqual([]);
    } finally {
      unmountUpdate();
      unmount();
      registry.dispose();
    }
  }),
);
