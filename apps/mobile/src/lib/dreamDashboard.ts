import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  resolveThreadListV2Status,
  threadHasUnseenCompletion,
} from "../features/threads/threadListV2";
import { scopedProjectKey, scopedThreadKey } from "./scopedEntities";

export const DREAM_KPIS = {
  status: "Session status",
  working: "Working",
  input: "Requests",
  questions: "Questions",
  finished: "Finished",
  failed: "Failed",
  tokens: "24h tokens",
  cost: "24h cost",
  limits: "Quota left",
  connections: "Machines",
  "": "None",
} as const;
export type DreamKpi = keyof typeof DREAM_KPIS;
export const DREAM_LAYOUTS = { dashboard: "Dashboard", focus: "Focus", clock: "Clock" } as const;
export type DreamLayout = keyof typeof DREAM_LAYOUTS;
export const DREAM_PALETTES = { theme: "Theme", mono: "Mono", amber: "Amber night" } as const;
export type DreamPalette = keyof typeof DREAM_PALETTES;
export const DREAM_CLOCKS = { system: "System", "12": "12-hour", "24": "24-hour" } as const;
export type DreamClock = keyof typeof DREAM_CLOCKS;
export const DREAM_BRIGHTNESS = { full: "Default", medium: "Medium", low: "Low" } as const;
export type DreamBrightness = keyof typeof DREAM_BRIGHTNESS;
export const DREAM_DIM_OPACITY: Record<DreamBrightness, number> = {
  full: 0,
  medium: 0.35,
  low: 0.65,
};

export interface DreamPreferences {
  readonly layout: DreamLayout;
  readonly slots: readonly DreamKpi[];
  readonly all: boolean;
  readonly projects: readonly string[];
  readonly threads: readonly string[];
  readonly palette: DreamPalette;
  readonly clock: DreamClock;
  readonly showDate: boolean;
  readonly showStatus: boolean;
  readonly brightness: DreamBrightness;
  readonly pixelShift: boolean;
}
const DEFAULT_DREAM_SLOTS: readonly DreamKpi[] = ["status", "tokens", "cost", "limits", ""];
export function dreamVisibleSlots(preferences: Pick<DreamPreferences, "layout" | "slots">) {
  return preferences.layout === "clock"
    ? []
    : preferences.layout === "focus"
      ? preferences.slots.slice(0, 1)
      : preferences.slots;
}

export function resolveDreamQuota(
  providers: readonly {
    readonly name: string;
    readonly expiresAt: number;
    readonly partial?: boolean;
    readonly windows: readonly { readonly remaining: number; readonly label: string }[];
  }[],
  now: number,
  incomplete = false,
) {
  const tightest = providers
    .flatMap((provider) =>
      provider.expiresAt > now
        ? provider.windows.map((window) => ({ name: provider.name, ...window }))
        : [],
    )
    .sort((a, b) => a.remaining - b.remaining)[0];
  return tightest
    ? {
        ...tightest,
        partial:
          incomplete ||
          providers.some(
            (provider) =>
              provider.partial === true ||
              provider.expiresAt <= now ||
              provider.windows.length === 0,
          ),
      }
    : null;
}

export function dreamClockFontSize(width: number, height: number) {
  return Math.max(48, Math.min(width * 0.36, height * 0.46, 480));
}

export function resolveDreamConnection(source: {
  readonly ready: boolean;
  readonly configured: number;
  readonly selected: number;
  readonly live: number;
}) {
  if (!source.ready) return "loading";
  if (source.configured === 0) return "unconfigured";
  if (source.selected === 0) return "unselected";
  if (source.live === 0) return "offline";
  return source.live < source.selected ? "partial" : "live";
}

export function normalizeDreamPreferences(value: unknown): DreamPreferences {
  const saved =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  const choice = <T extends string>(value: unknown, options: Record<T, unknown>, fallback: T): T =>
    typeof value === "string" && Object.hasOwn(options, value) ? (value as T) : fallback;
  return {
    layout: choice(saved.layout, DREAM_LAYOUTS, "dashboard"),
    slots: Array.isArray(saved.slots)
      ? Array.from({ length: 5 }, (_, index) => {
          const slot: unknown = (saved.slots as unknown[])[index];
          return typeof slot === "string" && Object.hasOwn(DREAM_KPIS, slot)
            ? (slot as DreamKpi)
            : "";
        })
      : DEFAULT_DREAM_SLOTS,
    all: saved.all !== false,
    projects: strings(saved.projects),
    threads: strings(saved.threads),
    // `monochrome` is the pre-palette switch.
    palette: choice(saved.palette, DREAM_PALETTES, saved.monochrome === true ? "mono" : "theme"),
    clock: choice(saved.clock, DREAM_CLOCKS, "system"),
    showDate: saved.showDate !== false,
    showStatus: saved.showStatus !== false,
    brightness: choice(saved.brightness, DREAM_BRIGHTNESS, "full"),
    pixelShift: saved.pixelShift !== false,
  };
}
/** Puts a KPI in a slot; one already shown elsewhere trades places so none repeats. */
export function assignDreamSlot(
  slots: readonly DreamKpi[],
  index: number,
  kpi: DreamKpi,
): readonly DreamKpi[] {
  if (index < 0 || index >= slots.length) return slots;
  const next = [...slots];
  const elsewhere = kpi === "" ? -1 : next.findIndex((slot, at) => at !== index && slot === kpi);
  if (elsewhere >= 0) next[elsewhere] = next[index]!;
  next[index] = kpi;
  return next;
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

const DREAM_STATUS_LABELS = {
  working: DREAM_KPIS.working,
  input: DREAM_KPIS.input,
  questions: DREAM_KPIS.questions,
  failed: DREAM_KPIS.failed,
  limited: "Limited",
  waiting: "Waiting",
  finished: DREAM_KPIS.finished,
} as const;

export function resolveDreamStatus(counts: ReturnType<typeof summarizeDreamThreads>) {
  const rows = [
    { keys: ["failed"] as const, label: "Failed", value: counts.failed },
    { keys: ["limited"] as const, label: "Limited", value: counts.limited },
    { keys: ["waiting"] as const, label: "Waiting", value: counts.waiting },
    { keys: ["working"] as const, label: "Working", value: counts.working },
    {
      keys: ["input", "questions"] as const,
      label: "Need you",
      value: counts.input + counts.questions,
    },
    { keys: ["finished"] as const, label: "Finished", value: counts.finished },
  ];
  return rows.filter(
    (row) =>
      row.value > 0 ||
      row.keys[0] === "working" ||
      row.keys[0] === "input" ||
      row.keys[0] === "finished",
  );
}

export function dreamStatusSummary(
  counts: ReturnType<typeof summarizeDreamThreads>,
  partial: boolean,
) {
  return `${partial ? "Partial session status" : "Session status"}. ${Object.entries(
    DREAM_STATUS_LABELS,
  )
    .map(([key, label]) => `${counts[key as keyof typeof counts]} ${label.toLowerCase()}`)
    .join(". ")}`;
}
