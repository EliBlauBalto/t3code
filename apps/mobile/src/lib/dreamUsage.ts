import { USAGE_CONTRACT_VERSION, type EnvironmentId } from "@t3tools/contracts";
import { isCompatibleUsageContractVersion, mergeUsage } from "@t3tools/shared/usageMerge";
import type { UsageView } from "../state/usage";

export interface DreamUsageReading {
  readonly scope: string;
  readonly contributorIds: readonly EnvironmentId[];
  readonly tokens: number;
  readonly costUsd: number | null;
  readonly costPartial: boolean;
  readonly estimated: boolean;
  readonly partial: boolean;
  readonly refreshing: boolean;
}

export function resolveDreamUsage(
  previous: DreamUsageReading | null,
  environmentIds: ReadonlySet<EnvironmentId>,
  usage: Pick<UsageView, "merged" | "selectedEnvironments">,
): DreamUsageReading | null {
  const available = usage.selectedEnvironments.filter(
    (entry) =>
      environmentIds.has(entry.environmentId) &&
      entry.isConnected &&
      entry.canReadDiagnostics &&
      entry.error === null &&
      (entry.summary === null ||
        (isCompatibleUsageContractVersion(entry.summary.contractVersion, USAGE_CONTRACT_VERSION) &&
          entry.summary.sources.some(
            (source) => source.status === "ok" || source.status === "partial",
          ) &&
          entry.summary.sources.every(
            (source) =>
              (source.status === "ok" ||
                source.status === "partial" ||
                source.status === "missing") &&
              (source.refreshing !== true || entry.isPending),
          ))),
  );
  const scope = JSON.stringify([...environmentIds].sort());
  const availableIds = new Set(available.map((entry) => entry.environmentId));
  const answered = available.filter((entry) => entry.summary !== null && !entry.isPending);
  const pending = available.some((entry) => entry.summary === null || entry.isPending);
  if (
    pending &&
    previous?.scope === scope &&
    previous.contributorIds.every((id) => availableIds.has(id)) &&
    answered.every((entry) => previous.contributorIds.includes(entry.environmentId))
  ) {
    return previous.refreshing ? previous : { ...previous, refreshing: true };
  }
  if (answered.length === 0) return null;
  const merged =
    answered.length === usage.selectedEnvironments.length
      ? usage.merged
      : mergeUsage(
          answered.flatMap((entry) =>
            entry.summary === null
              ? []
              : [
                  {
                    environmentId: entry.environmentId,
                    label: entry.label,
                    summary: entry.summary,
                  },
                ],
          ),
          USAGE_CONTRACT_VERSION,
        );
  const next = {
    scope,
    contributorIds: answered.map((entry) => entry.environmentId),
    tokens: merged.totalTokens,
    costUsd: merged.costQuality.unpricedShare < 1 ? merged.costUsd : null,
    costPartial: merged.costQuality.unpricedShare > 0,
    estimated: merged.costQuality.modelPricedShare > 0,
    partial:
      answered.length < environmentIds.size ||
      answered.some((entry) =>
        entry.summary?.sources.some((source) => source.status === "partial"),
      ),
    refreshing: pending,
  };
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}
