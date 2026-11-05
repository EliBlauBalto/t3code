import {
  EnvironmentId,
  UsageDay,
  USAGE_CONTRACT_VERSION,
  type UsageSummary,
} from "@t3tools/contracts";
import { mergeUsage } from "@t3tools/shared/usageMerge";
import { expect, it } from "vite-plus/test";
import { resolveDreamUsage } from "./dreamUsage";

it("keeps the last valid reading during a refresh but clears it after access, connection or scope changes", () => {
  const ids = new Set([EnvironmentId.make("a")]);
  const empty = mergeUsage([], USAGE_CONTRACT_VERSION);
  const summary: UsageSummary = {
    contractVersion: USAGE_CONTRACT_VERSION,
    sinceDay: UsageDay.make("2026-11-04"),
    untilDay: UsageDay.make("2026-11-04"),
    timeZone: "UTC",
    readAt: "2026-11-04T20:00:00Z",
    buckets: [],
    sources: [
      {
        fingerprint: {
          hostId: "fictional",
          provider: "codex",
          resolvedHomePath: "/fictional",
          volumeId: "fixture",
        },
        status: "ok",
        scannedFiles: 0,
        skippedFiles: 0,
        malformedRecords: 0,
        distinctSessions: 0,
        message: null,
      },
    ],
    pricing: { status: "fresh", source: "fixture", fetchedAt: null, knownModels: 0 },
    scanDurationMs: 0,
  };
  const current = {
    merged: { ...empty, totalTokens: 1200, costUsd: 3 },
    selectedEnvironments: [
      {
        environmentId: EnvironmentId.make("a"),
        label: "A",
        isConnected: true,
        canReadDiagnostics: true,
        isPending: false,
        error: null,
        needsCursorKeychainAccess: false,
        summary,
      },
    ],
  };
  const reading = resolveDreamUsage(null, ids, current);
  expect(reading).toMatchObject({ tokens: 1200, costUsd: 3, refreshing: false });
  expect(resolveDreamUsage(reading, ids, current)).toBe(reading);
  const pending = {
    ...current,
    selectedEnvironments: current.selectedEnvironments.map((entry) => ({
      ...entry,
      isPending: true,
      summary: null,
    })),
  };
  expect(resolveDreamUsage(reading, ids, pending)).toMatchObject({
    tokens: 1200,
    costUsd: 3,
    refreshing: true,
  });
  expect(
    resolveDreamUsage(reading, ids, {
      ...pending,
      selectedEnvironments: pending.selectedEnvironments.map((entry) => ({
        ...entry,
        isPending: false,
      })),
    }),
  ).toMatchObject({ tokens: 1200, refreshing: true });
  for (const change of [
    { isConnected: false },
    { canReadDiagnostics: false },
    { error: "Denied" },
  ]) {
    expect(
      resolveDreamUsage(reading, ids, {
        ...pending,
        selectedEnvironments: pending.selectedEnvironments.map((entry) => ({
          ...entry,
          ...change,
        })),
      }),
    ).toBeNull();
  }
  expect(resolveDreamUsage(reading, new Set([EnvironmentId.make("b")]), pending)).toBeNull();
  expect(
    resolveDreamUsage(reading, new Set(), { ...pending, selectedEnvironments: [] }),
  ).toBeNull();
});
