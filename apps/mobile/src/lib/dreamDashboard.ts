import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  resolveThreadListV2Status,
  threadHasUnseenCompletion,
} from "../features/threads/threadListV2";
import { scopedProjectKey, scopedThreadKey } from "./scopedEntities";

export const DREAM_KPIS = {
  status: "Session status",
  working: "Working",
  input: "Input",
  questions: "Questions",
  finished: "Finished",
  failed: "Failed",
  tokens: "Tokens · 24h",
  cost: "Cost · 24h",
  limits: "Quota remaining",
  connections: "Connections",
  "": "Empty",
} as const;
export type DreamKpi = keyof typeof DREAM_KPIS;
export interface DreamPreferences {
  readonly slots: readonly DreamKpi[];
  readonly all: boolean;
  readonly projects: readonly string[];
  readonly threads: readonly string[];
  readonly monochrome: boolean;
}
export function normalizeDreamPreferences(value: unknown): DreamPreferences {
  const saved =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  return {
    slots: Array.isArray(saved.slots)
      ? Array.from({ length: 5 }, (_, index) => {
          const slot: unknown = (saved.slots as unknown[])[index];
          return typeof slot === "string" && Object.hasOwn(DREAM_KPIS, slot)
            ? (slot as DreamKpi)
            : "";
        })
      : ["status", "tokens", "cost", "limits", "working"],
    all: saved.all !== false,
    projects: strings(saved.projects),
    threads: strings(saved.threads),
    monochrome: saved.monochrome === true,
  };
}
export function moveDreamSlot(
  slots: readonly DreamKpi[],
  from: number,
  to: number,
): readonly DreamKpi[] {
  if (from < 0 || from >= slots.length || to < 0 || to >= slots.length) return slots;
  const next = [...slots];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}
export function dreamDropIndex(heights: readonly number[], from: number, translation: number) {
  const centers: number[] = [];
  let offset = 0;
  for (const height of heights) {
    if (!Number.isFinite(height) || height <= 0) return from;
    centers.push(offset + height / 2);
    offset += height;
  }
  const start = centers[from];
  if (start === undefined || !Number.isFinite(translation)) return from;
  let target = from;
  for (let index = 0; index < centers.length; index++) {
    if (
      Math.abs(centers[index]! - start - translation) <
      Math.abs(centers[target]! - start - translation)
    )
      target = index;
  }
  return target;
}
export function selectDreamThreads(
  threads: readonly EnvironmentThreadShell[],
  preferences: DreamPreferences,
) {
  const projects = new Set(preferences.projects);
  const selected = new Set(preferences.threads);
  return threads.filter(
    (thread) =>
      thread.archivedAt === null &&
      thread.deletedAt === null &&
      (preferences.all ||
        projects.has(scopedProjectKey(thread.environmentId, thread.projectId)) ||
        selected.has(scopedThreadKey(thread.environmentId, thread.id))),
  );
}
export function summarizeDreamThreads(threads: readonly EnvironmentThreadShell[]) {
  const counts = {
    working: 0,
    input: 0,
    questions: 0,
    finished: 0,
    failed: 0,
    waiting: 0,
    limited: 0,
  };
  for (const thread of threads) {
    const status = resolveThreadListV2Status(thread);
    if (status === "approval" || status === "request") counts.input++;
    else if (status === "input") counts.questions++;
    else if (status === "ready") {
      if (thread.latestRun?.status === "completed" && threadHasUnseenCompletion(thread))
        counts.finished++;
    } else counts[status]++;
  }
  return counts;
}
