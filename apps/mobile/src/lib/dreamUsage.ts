import type { EnvironmentId } from "@t3tools/contracts";
import type { UsageView } from "../state/usage";

export interface DreamUsageReading {
  readonly scope: string;
  readonly tokens: number;
  readonly costUsd: number | null;
  readonly estimated: boolean;
  readonly refreshing: boolean;
}

export function resolveDreamUsage(
  previous: DreamUsageReading | null,
  environmentIds: ReadonlySet<EnvironmentId>,
  usage: Pick<UsageView, "merged" | "selectedEnvironments">,
): DreamUsageReading | null {
  const scope = JSON.stringify([...environmentIds].sort());
  const available =
    environmentIds.size > 0 &&
    usage.selectedEnvironments.length === environmentIds.size &&
    usage.merged.contractMismatches.length === 0 &&
    usage.selectedEnvironments.every(
      (entry) =>
        environmentIds.has(entry.environmentId) &&
        entry.isConnected &&
        entry.canReadDiagnostics &&
        entry.error === null &&
        (entry.summary === null || entry.summary.sources.every((source) => source.status === "ok")),
    );
  const ready =
    available &&
    usage.selectedEnvironments.every(
      (entry) =>
        entry.summary !== null &&
        !entry.isPending &&
        entry.summary.sources.length > 0 &&
        entry.summary.sources.every(
          (source) => source.status === "ok" && source.refreshing !== true,
        ),
    );
  if (!ready) {
    const pending = usage.selectedEnvironments.some(
      (entry) =>
        entry.summary === null ||
        entry.isPending ||
        entry.summary.sources.some((source) => source.refreshing === true),
    );
    return available && pending && previous?.scope === scope
      ? previous.refreshing
        ? previous
        : { ...previous, refreshing: true }
      : null;
  }
  const next = {
    scope,
    tokens: usage.merged.totalTokens,
    costUsd: usage.merged.costQuality.unpricedShare === 0 ? usage.merged.costUsd : null,
    estimated: usage.merged.costQuality.modelPricedShare > 0,
    refreshing: false,
  };
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}
