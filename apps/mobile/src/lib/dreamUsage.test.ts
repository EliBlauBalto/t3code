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
    buckets: [
      {
        day: UsageDay.make("2026-11-04"),
        provider: "codex",
        model: "fixture-model",
        totals: {
          uncachedInputTokens: 1000,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 200,
          reasoningTokens: 0,
        },
        costUsd: 3,
        cacheSavingsUsd: 0,
        costSource: "providerReported",
        records: 1,
        unpricedRecords: 0,
        sessions: 1,
      },
    ],
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
  const withSources = (sources: UsageSummary["sources"], isPending = false) => ({
    ...current,
    selectedEnvironments: current.selectedEnvironments.map((entry) => ({
      ...entry,
      isPending,
      summary: { ...summary, sources },
    })),
  });
  const source = summary.sources[0]!;
  const missing = {
    ...source,
    fingerprint: { ...source.fingerprint, provider: "claude" as const },
    status: "missing" as const,
  };
  expect.soft(resolveDreamUsage(null, ids, withSources([source, missing]))).toMatchObject({
    tokens: 1200,
    costUsd: 3,
    partial: false,
  });
  expect
    .soft(resolveDreamUsage(null, ids, withSources([{ ...source, status: "partial" }])))
    .toMatchObject({ tokens: 1200, partial: true });
  expect(resolveDreamUsage(null, ids, withSources([missing]))).toBeNull();
  expect(
    resolveDreamUsage(null, ids, {
      ...withSources([source]),
      merged: empty,
      selectedEnvironments: current.selectedEnvironments.map((entry) => ({
        ...entry,
        summary: { ...summary, buckets: [] },
      })),
    }),
  ).toMatchObject({
    tokens: 0,
    costUsd: 0,
  });
  const bothIds = new Set([...ids, EnvironmentId.make("b")]);
  const second = {
    ...current.selectedEnvironments[0]!,
    environmentId: EnvironmentId.make("b"),
    label: "B",
    summary: {
      ...summary,
      sources: [{ ...source, fingerprint: { ...source.fingerprint, hostId: "second" } }],
    },
  };
  const both = { ...current, selectedEnvironments: [...current.selectedEnvironments, second] };
  const full = resolveDreamUsage(null, bothIds, {
    ...both,
    merged: { ...empty, totalTokens: 2400, costUsd: 6 },
  });
  expect(full).toMatchObject({ tokens: 2400, costUsd: 6, partial: false });
  expect
    .soft(
      resolveDreamUsage(full, bothIds, {
        ...both,
        selectedEnvironments: [
          current.selectedEnvironments[0]!,
          { ...second, summary: null, isPending: true },
        ],
      }),
    )
    .toMatchObject({ tokens: 2400, costUsd: 6, partial: false, refreshing: true });
  for (const change of [
    { isConnected: false },
    { canReadDiagnostics: false },
    { error: "Denied" },
    { summary: { ...second.summary, sources: [missing] } },
    { summary: { ...second.summary, contractVersion: USAGE_CONTRACT_VERSION + 10000 } },
    { summary: { ...second.summary, sources: [{ ...source, refreshing: true as const }] } },
  ]) {
    const reduced = {
      ...both,
      selectedEnvironments: [current.selectedEnvironments[0]!, { ...second, ...change }],
    };
    expect.soft(resolveDreamUsage(full, bothIds, reduced)).toMatchObject({
      tokens: 1200,
      costUsd: 3,
      partial: true,
    });
  }
  expect
    .soft(
      resolveDreamUsage(null, ids, {
        ...current,
        merged: { ...current.merged, costQuality: { ...empty.costQuality, unpricedShare: 0.01 } },
      }),
    )
    .toMatchObject({ tokens: 1200, costUsd: 3, costPartial: true });
  expect(
    resolveDreamUsage(null, ids, {
      ...current,
      merged: { ...current.merged, costQuality: { ...empty.costQuality, unpricedShare: 1 } },
    }),
  ).toMatchObject({ tokens: 1200, costUsd: null });
  expect
    .soft(
      resolveDreamUsage(full, bothIds, {
        ...both,
        selectedEnvironments: [{ ...second, isConnected: false }, ...pendingEntries()],
      }),
    )
    .toBeNull();
  function pendingEntries() {
    return current.selectedEnvironments.map((entry) => ({
      ...entry,
      summary: null,
      isPending: true,
    }));
  }
  const refreshing = [{ ...source, refreshing: true as const }];
  expect(resolveDreamUsage(reading, ids, withSources(refreshing, true))).toMatchObject({
    tokens: 1200,
    refreshing: true,
  });
  expect.soft(resolveDreamUsage(reading, ids, withSources(refreshing))).toBeNull();
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
