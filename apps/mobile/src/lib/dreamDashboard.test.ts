import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import { makeThreadShellFixture, makeRawThreadShell } from "../test-fixtures";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  normalizeDreamPreferences,
  assignDreamSlot,
  selectDreamThreads,
  summarizeDreamThreads,
  resolveDreamConnection,
  dreamClockFontSize,
  dreamTileScale,
} from "./dreamDashboard";

it("keeps native text sizes positive before layout and during zero-size surface transitions", () => {
  for (const [width, height] of [
    [0, 0],
    [0, 640],
    [360, 0],
  ] as const) {
    expect(dreamClockFontSize(width, height)).toBeGreaterThan(0);
    expect(dreamTileScale(0.8, { width, height }, true, 1)).toBe(0.8);
  }
  expect(dreamTileScale(0.8, undefined, false, 1)).toBe(0.8);
});

it("distinguishes missing setup, an empty selection, and disconnected selected machines", () => {
  const connected = { ready: true, configured: 2, selected: 2, live: 2 };
  expect(resolveDreamConnection({ ...connected, ready: false })).toBe("loading");
  expect(resolveDreamConnection({ ...connected, configured: 0, selected: 0, live: 0 })).toBe(
    "unconfigured",
  );
  expect(resolveDreamConnection({ ...connected, selected: 0, live: 0 })).toBe("unselected");
  expect(resolveDreamConnection({ ...connected, live: 0 })).toBe("offline");
  expect(resolveDreamConnection({ ...connected, live: 1 })).toBe("partial");
  expect(resolveDreamConnection(connected)).toBe("live");
});

it("preserves empty slots and repairs invalid saved configuration without exceeding five slots", () => {
  expect(
    normalizeDreamPreferences({
      slots: ["cost", "", "garbage", "status", "tokens", "working"],
      projects: ["a", 2],
      threads: [],
      all: false,
    }).slots,
  ).toEqual(["cost", "", "", "status", "tokens"]);
  expect(normalizeDreamPreferences({ slots: null }).slots).toEqual([
    "status",
    "tokens",
    "cost",
    "limits",
    "working",
  ]);
  expect(normalizeDreamPreferences({ projects: ["a", 2], all: false }).projects).toEqual(["a"]);
});

it("assigns a KPI to a slot, swapping with the slot that already shows it and allowing blanks", () => {
  const slots = ["status", "tokens", "", "cost", "limits"] as const;
  expect(assignDreamSlot(slots, 0, "cost")).toEqual(["cost", "tokens", "", "status", "limits"]);
  expect(assignDreamSlot(slots, 1, "working")).toEqual(["status", "working", "", "cost", "limits"]);
  expect(assignDreamSlot(slots, 1, "")).toEqual(["status", "", "", "cost", "limits"]);
  expect(assignDreamSlot(slots, 9, "cost")).toBe(slots);
});

it("reads the legacy monochrome switch and defaults display options for older saved settings", () => {
  expect(normalizeDreamPreferences({ monochrome: true }).palette).toBe("mono");
  expect(normalizeDreamPreferences({ monochrome: true, palette: "amber" }).palette).toBe("amber");
  expect(normalizeDreamPreferences({ palette: "neon", clock: "9", brightness: 1 })).toMatchObject({
    palette: "theme",
    clock: "system",
    brightness: "full",
    showDate: true,
    showStatus: true,
    pixelShift: true,
  });
  expect(normalizeDreamPreferences({ showDate: false, pixelShift: false })).toMatchObject({
    showDate: false,
    pixelShift: false,
  });
  expect(normalizeDreamPreferences(undefined)).toMatchObject({ layout: "dashboard" });
  expect(normalizeDreamPreferences({ layout: "unknown" })).toMatchObject({ layout: "dashboard" });
  for (const layout of ["focus", "clock"]) {
    expect(normalizeDreamPreferences({ layout, slots: ["cost", "tokens"] })).toMatchObject({
      layout,
      slots: ["cost", "tokens", "", "", ""],
    });
  }
});

it("scopes selection by environment as well as project and thread, and an empty selection stays empty", () => {
  const first = makeThreadShellFixture({
    environmentId: EnvironmentId.make("one"),
    projectId: ProjectId.make("p"),
    id: ThreadId.make("t"),
  });
  const other = { ...first, environmentId: EnvironmentId.make("two") };
  const config = normalizeDreamPreferences({ all: false, projects: ["one:p"] });
  expect(selectDreamThreads([first, other], config)).toEqual([first]);
  expect(
    selectDreamThreads([first, other], { ...config, projects: [], threads: ["two:t"] }),
  ).toEqual([other]);
  expect(selectDreamThreads([first], { ...config, projects: [] })).toEqual([]);
  expect(
    selectDreamThreads([{ ...first, archivedAt: "2026-01-01" }], { ...config, all: true }),
  ).toEqual([]);
});

it("uses existing status and visit semantics, assigns one status per entry, and clears viewed completions", () => {
  const running = presentThreadShell(
    EnvironmentId.make("one"),
    makeRawThreadShell({
      status: "running",
      activeRunId: RunId.make("r"),
      latestRunId: RunId.make("r"),
    }),
  );
  const finished = makeThreadShellFixture({
    lastVisitedAt: "2026-01-01T00:00:00.000Z",
    latestRun: {
      runId: RunId.make("done"),
      status: "completed",
      requestedAt: null,
      startedAt: null,
      completedAt: "2026-01-02T00:00:00.000Z",
      assistantMessageId: null,
    },
  });
  const counts = summarizeDreamThreads([
    running,
    { ...running, hasPendingApprovals: true },
    { ...running, hasPendingUserInput: true },
    finished,
  ]);
  expect(counts).toMatchObject({ working: 1, input: 1, questions: 1, finished: 1 });
  expect(
    summarizeDreamThreads([{ ...finished, lastVisitedAt: "2026-01-03T00:00:00.000Z" }]).finished,
  ).toBe(0);
  expect(summarizeDreamThreads([{ ...finished, lastVisitedAt: undefined }]).finished).toBe(0);
});
