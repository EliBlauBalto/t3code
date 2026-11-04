import { act, type ReactNode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const entry = vi.hoisted(() => ({
  component: null as ComponentType | null,
  dream: null as (() => ComponentType) | null,
  splashVisible: true,
}));

vi.mock("expo", () => ({
  registerRootComponent: (component: ComponentType) => {
    entry.component = component;
  },
}));
vi.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: async () => {},
  hideAsync: async () => {
    entry.splashVisible = false;
  },
}));
vi.mock("react-native", () => ({
  AppRegistry: {
    registerComponent: (_name: string, component: () => ComponentType) => {
      entry.dream = component;
    },
    registerHeadlessTask: () => {},
  },
  Platform: { OS: "android" },
  LogBox: { ignoreAllLogs: () => {} },
  View: ({ children, onLayout }: { children?: ReactNode; onLayout?: () => void }) => (
    <div ref={() => onLayout?.()}>{children}</div>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Button: ({ title, onPress }: { title: string; onPress: () => void }) => (
    <button onClick={onPress}>{title}</button>
  ),
}));
vi.mock("./features/observability/observe", () => ({}));
vi.mock("react-native-gesture-handler", () => ({}));
vi.mock("react-native-screens", () => ({
  featureFlags: { experiment: { synchronousScreenUpdatesEnabled: false } },
}));
vi.mock("./App", () => {
  throw new Error("Native dependency could not initialize");
});
vi.mock("./features/dream/DreamDashboard", () => ({ default: () => <span>Dream surface</span> }));

it("registers the app before loading its modules and exposes startup failures above the splash", async () => {
  vi.stubGlobal("__DEV__", false);
  using _console = vi.spyOn(console, "error").mockImplementation(() => {});
  entry.component = null;
  entry.splashVisible = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await expect(import("../index")).resolves.toBeDefined();
    const App = entry.component!;
    await act(async () => root.render(<App />));
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Native dependency could not initialize");
      expect(entry.splashVisible).toBe(false);
    });
    const Dream = entry.dream!();
    await act(async () => root.render(<Dream />));
    await vi.waitFor(() => expect(container.textContent).toContain("Dream surface"));
    expect(container.textContent).not.toContain("couldn't start");
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("retries a rejected app load and removes the startup overlay when ready", async () => {
  using _console = vi.spyOn(console, "error").mockImplementation(() => {});
  const { AppStartup, useAppStartupReady } = await import("./AppStartup");
  let attempts = 0;
  function ReadyApp() {
    useAppStartupReady(true);
    return <span>Connected workspace</span>;
  }
  const load = async () => {
    if (++attempts === 1) throw new Error("Module initialization failed");
    return { default: ReadyApp };
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AppStartup load={load} />));
    expect(container.textContent).toContain("Module initialization failed");
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toBe("Connected workspace");
  } finally {
    act(() => root.unmount());
  }
});

it("replaces stalled startup with recovery and cancels the deadline once ready", async () => {
  using _console = vi.spyOn(console, "error").mockImplementation(() => {});
  const { AppStartup, useAppStartupReady } = await import("./AppStartup");
  let attempts = 0;
  function ReadyApp() {
    useAppStartupReady(true);
    return <span>Workspace ready</span>;
  }
  const load = async () => ({ default: ++attempts === 1 ? () => null : ReadyApp });
  const container = document.createElement("div");
  const root = createRoot(container);
  vi.useFakeTimers();
  try {
    await act(async () => root.render(<AppStartup load={load} />));
    expect(container.textContent).toContain("Starting T3 Code");
    await act(async () => vi.advanceTimersByTime(15_000));
    expect(container.textContent).toContain("Startup has not finished");
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toBe("Workspace ready");
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(container.textContent).toBe("Workspace ready");
  } finally {
    act(() => root.unmount());
    vi.useRealTimers();
  }
});

it("exposes errors thrown by a loaded root before its readiness signal", async () => {
  using _console = vi.spyOn(console, "error").mockImplementation(() => {});
  const { AppStartup } = await import("./AppStartup");
  function BrokenApp(): never {
    throw new Error("Preference runtime failed");
  }
  const load = async () => ({ default: BrokenApp });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AppStartup load={load} />));
    expect(container.textContent).toContain("Preference runtime failed");
    expect(container.textContent).not.toContain("Starting T3 Code");
  } finally {
    act(() => root.unmount());
  }
});

it("allows a slow startup to finish after showing recovery controls", async () => {
  using _console = vi.spyOn(console, "error").mockImplementation(() => {});
  const { AppStartup, useAppStartupReady } = await import("./AppStartup");
  function ReadyApp() {
    useAppStartupReady(true);
    return <span>Slow workspace ready</span>;
  }
  let complete!: (value: { default: typeof ReadyApp }) => void;
  const pending = new Promise<{ default: typeof ReadyApp }>((resolve) => {
    complete = resolve;
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  vi.useFakeTimers();
  try {
    await act(async () => root.render(<AppStartup load={() => pending} />));
    await act(async () => vi.advanceTimersByTime(15_000));
    expect(container.querySelector("button")?.textContent).toBe("Try again");
    await act(async () => complete({ default: ReadyApp }));
    expect(container.textContent).toBe("Slow workspace ready");
  } finally {
    act(() => root.unmount());
    vi.useRealTimers();
  }
});
