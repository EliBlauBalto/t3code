import { act, createElement, useLayoutEffect } from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry } from "effect/reactivity";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
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
vi.mock("../../state/threads", async () => {
  const { Atom } = await import("effect/reactivity");
  const quiet = Atom.make<EnvironmentThreadShell | null>(null);
  return {
    environmentThreadShells: {
      navigationThreadShellsAtom: Atom.make<readonly EnvironmentThreadShell[]>([]),
      quietThreadShellAtom: () => quiet,
    },
  };
});
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
import { useDreamClock, useDreamSources } from "./useDreamDashboard";
import { environmentThreadShells } from "../../state/threads";
import { makeThreadShellFixture } from "../../test-fixtures";

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
          slots: ["status", "tokens", "cost", "limits", "connections"],
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

it("wakes at quota deadlines as well as minute boundaries and releases its timer", async () => {
  storage.preferences = {};
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const start = Date.parse("2026-11-04T12:10:00Z");
  vi.useFakeTimers({ now: start });
  const baselineTimers = vi.getTimerCount();
  const root = createRoot(document.createElement("div"));
  const readings: Array<ReturnType<typeof useDreamClock>> = [];
  function Probe({ deadlines }: { readonly deadlines: readonly number[] }) {
    const clock = useDreamClock(deadlines);
    useLayoutEffect(() => {
      readings.push(clock);
    }, [clock]);
    return null;
  }
  try {
    act(() => root.render(createElement(Probe, { deadlines: [start + 30_000, start + 45_000] })));
    expect(vi.getTimerCount()).toBe(baselineTimers + 1);
    for (const elapsed of [30_000, 15_000, 15_000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(elapsed);
      });
    }
    expect([...new Set(readings.map((reading) => reading.now.getTime()))]).toEqual([
      start,
      start + 30_000,
      start + 45_000,
      start + 60_000,
    ]);
    vi.setSystemTime(start + 70_000);
    act(() => root.render(createElement(Probe, { deadlines: [start + 65_000] })));
    expect(readings.at(-1)!.now.getTime()).toBe(start + 70_000);
    expect(readings.at(-1)!.window).toEqual(readings[0]!.window);
    expect(vi.getTimerCount()).toBe(baselineTimers + 1);
  } finally {
    act(() => root.unmount());
    const remainingTimers = vi.getTimerCount();
    vi.useRealTimers();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    expect(remainingTimers).toBe(baselineTimers);
  }
});

it.effect(
  "ignores streaming-only shell changes while preserving quiet updates and navigation membership",
  () =>
    Effect.gen(function* () {
      storage.preferences = {};
      const registry = AtomRegistry.make();
      const thread = makeThreadShellFixture({
        environmentId: EnvironmentId.make("env"),
        id: ThreadId.make("thread"),
        projectId: ProjectId.make("project"),
        title: "Fixture session",
      });
      const quiet = environmentThreadShells.quietThreadShellAtom({
        environmentId: thread.environmentId,
        threadId: thread.id,
      });
      const navigation = environmentThreadShells.navigationThreadShellsAtom;
      if (!Atom.isWritable(navigation) || !Atom.isWritable(quiet))
        throw new Error("Fixture atoms must be writable");
      registry.set(navigation, [thread]);
      registry.set(quiet, thread);
      const unmount = registry.mount(mobilePreferencesAtom);
      const captured: Array<ReturnType<typeof useDreamSources>> = [];
      function Capture() {
        captured.push(useDreamSources());
        return null;
      }
      const read = () => {
        renderToString(
          createElement(RegistryContext.Provider, { value: registry }, createElement(Capture)),
        );
        return captured.at(-1)!;
      };
      try {
        yield* AtomRegistry.getResult(registry, mobilePreferencesAtom, { suspendOnWaiting: true });
        const before = read();
        registry.set(navigation, [{ ...thread, updatedAt: "2026-11-04T21:00:01Z" }]);
        const streamed = read();
        expect.soft(streamed.threads).toBe(before.threads);
        expect.soft(streamed.projects).toBe(before.projects);
        const approval = { ...thread, hasPendingApprovals: true };
        registry.set(quiet, approval);
        expect(read().threads).toEqual([approval]);
        registry.set(navigation, []);
        expect(read().threads).toEqual([]);
      } finally {
        unmount();
        registry.dispose();
      }
    }),
);
