import { EnvironmentId } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  appState: "active",
  appStateListeners: new Set<() => void>(),
  refreshed: [] as string[],
}));

vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return fixture.appState;
    },
    addEventListener: (_event: string, listener: () => void) => {
      fixture.appStateListeners.add(listener);
      return { remove: () => fixture.appStateListeners.delete(listener) };
    },
  },
  AccessibilityInfo: { addEventListener: vi.fn(), isReduceMotionEnabled: vi.fn() },
}));

vi.mock("../state/atom-registry", async () => {
  const { AtomRegistry } = await import("effect/reactivity");
  return { appAtomRegistry: AtomRegistry.make() };
});

vi.mock("../connection/catalog", async () => {
  const { Atom } = await import("effect/reactivity");
  return { environmentCatalog: { catalogValueAtom: Atom.make({ isReady: false }) } };
});

vi.mock("../state/presentation", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    environmentPresentations: { presentationsAtom: Atom.make(new Map<string, unknown>()) },
  };
});

vi.mock("../state/server", () => ({
  serverEnvironment: { refreshProviders: { label: "Refresh providers" } },
}));

vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  runAtomCommand: (
    _registry: unknown,
    _command: unknown,
    input: { readonly environmentId: string },
  ) => {
    fixture.refreshed.push(input.environmentId);
    return Promise.resolve();
  },
}));

import { environmentCatalog } from "../connection/catalog";
import { appAtomRegistry } from "../state/atom-registry";
import { environmentPresentations } from "../state/presentation";
import { installSubscriptionUsageRefresh } from "./useSubscriptionUsage";
import { WIDGET_REFRESH_INTERVAL } from "./subscriptionUsageSnapshot";

const registry = appAtomRegistry as AtomRegistry.AtomRegistry;
const catalogAtom = environmentCatalog.catalogValueAtom as unknown as Atom.Writable<{
  isReady: boolean;
}>;
const presentationsAtom = environmentPresentations.presentationsAtom as unknown as Atom.Writable<
  Map<string, { connection: { phase: string } }>
>;

const connected = EnvironmentId.make("env-connected");
const connecting = EnvironmentId.make("env-connecting");

describe("installSubscriptionUsageRefresh", () => {
  it("refreshes for a visible dream without treating the normal app as foreground, and stops on disposal", async () => {
    fixture.appState = "background";
    fixture.refreshed = [];
    fixture.appStateListeners.clear();
    vi.useFakeTimers({ now: 0 });
    const releaseCatalog = registry.mount(catalogAtom);
    const releasePresentations = registry.mount(presentationsAtom);
    registry.set(catalogAtom, { isReady: true });
    registry.set(
      presentationsAtom,
      new Map([
        [connected, { connection: { phase: "connected" } }],
        [connecting, { connection: { phase: "connected" } }],
      ]),
    );
    const dispose = installSubscriptionUsageRefresh(() => true, new Set([connected]));
    let disposed = false;
    try {
      expect(fixture.refreshed).toEqual([connected]);
      await vi.advanceTimersByTimeAsync(0);
      dispose();
      disposed = true;
      fixture.refreshed = [];
      vi.setSystemTime(WIDGET_REFRESH_INTERVAL + 1);
      registry.set(
        presentationsAtom,
        new Map([[connected, { connection: { phase: "connected" } }]]),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.refreshed).toEqual([]);
      await vi.advanceTimersByTimeAsync(WIDGET_REFRESH_INTERVAL);
      expect(fixture.refreshed).toEqual([]);
      expect(fixture.appState).toBe("background");
      expect(fixture.appStateListeners.size).toBe(0);
    } finally {
      if (!disposed) dispose();
      releasePresentations();
      releaseCatalog();
      vi.useRealTimers();
    }
  });
  it("refreshes connected environments once the catalog is ready and the app is active", () => {
    fixture.appState = "background";
    fixture.refreshed = [];
    registry.set(catalogAtom, { isReady: false });
    registry.set(
      presentationsAtom,
      new Map([
        [connected, { connection: { phase: "connected" } }],
        [connecting, { connection: { phase: "connecting" } }],
      ]),
    );

    const dispose = installSubscriptionUsageRefresh();
    registry.set(catalogAtom, { isReady: true });
    // Backgrounded: nothing refreshes yet.
    expect(fixture.refreshed).toEqual([]);

    fixture.appState = "active";
    for (const listener of fixture.appStateListeners) listener();
    expect(fixture.refreshed).toEqual([connected]);

    dispose();
    expect(fixture.appStateListeners.size).toBe(0);
  });
});
