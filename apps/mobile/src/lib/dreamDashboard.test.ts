import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import { makeThreadShellFixture, makeRawThreadShell } from "../test-fixtures";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  normalizeDreamPreferences,
  moveDreamSlot,
  dreamDropIndex,
  selectDreamThreads,
  summarizeDreamThreads,
} from "./dreamDashboard";

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

it("moves any KPI into the central slot while preserving every other slot including blanks", () => {
  expect(dreamDropIndex([88, 140, 88, 88, 88], 0, 160)).toBe(1);
  expect(dreamDropIndex([], 2, 160)).toBe(2);
  expect(moveDreamSlot(["status", "tokens", "", "cost", "limits"], 3, 0)).toEqual([
    "cost",
    "status",
    "tokens",
    "",
    "limits",
  ]);
  expect(moveDreamSlot(["status", "tokens", "", "cost", "limits"], 0, 4)).toEqual([
    "tokens",
    "",
    "cost",
    "limits",
    "status",
  ]);
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
