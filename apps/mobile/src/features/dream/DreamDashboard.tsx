import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { appAtomRegistry } from "../../state/atom-registry";
import { useUsage } from "../../state/usage";
import {
  dreamVisibleSlots,
  resolveDreamQuota,
  resolveDreamConnection,
  summarizeDreamThreads,
  type DreamKpi,
} from "../../lib/dreamDashboard";
import { resolveDreamUsage, type DreamUsageReading } from "../../lib/dreamUsage";
import {
  AppearancePreferencesProvider,
  useAppearancePreferences,
} from "../settings/appearance/AppearancePreferencesProvider";
import { buildSubscriptionUsageSnapshot } from "../../widgets/subscriptionUsageSnapshot";
import { installSubscriptionUsageRefresh } from "../../widgets/useSubscriptionUsage";
import { useDreamClock, useDreamSources } from "./useDreamDashboard";
import { DreamScene, resolveDreamPalette } from "./DreamScene";
import { CloudAuthProvider } from "../cloud/CloudAuthProvider";
import { useAppStartupReady } from "../../AppStartup";
import "../../../global.css";

const EMPTY_ENVIRONMENTS: ReadonlySet<EnvironmentId> = new Set();

const STATUS_COLORS = {
  live: "#34d399",
  partial: "#fbbf24",
  down: "#f87171",
  idle: "#8e8e93",
} as const;

export default function DreamDashboardRoot() {
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <CloudAuthProvider>
        <AppearancePreferencesProvider>
          <DreamDashboard />
        </AppearancePreferencesProvider>
      </CloudAuthProvider>
    </RegistryContext.Provider>
  );
}

export function DreamDashboard() {
  const source = useDreamSources();
  const { isReady } = useAppearancePreferences();
  useAppStartupReady(isReady);
  const quotaEnvironmentIds =
    source.initialized &&
    source.environmentIds.size > 0 &&
    dreamVisibleSlots(source.preferences).includes("limits")
      ? source.environmentIds
      : EMPTY_ENVIRONMENTS;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes selected-machine quota only while its native dream tile is visible
  useEffect(() => {
    if (quotaEnvironmentIds.size === 0) return;
    return installSubscriptionUsageRefresh(() => true, quotaEnvironmentIds);
  }, [quotaEnvironmentIds]);
  return <DreamDisplay source={source} />;
}

export function DreamDisplay({ source }: { readonly source: ReturnType<typeof useDreamSources> }) {
  const { preferences } = source;
  const visibleSlots = dreamVisibleSlots(preferences);
  const quotas = visibleSlots.includes("limits")
    ? buildSubscriptionUsageSnapshot(
        new Map([...source.presentations].filter(([id]) => source.environmentIds.has(id))),
        "",
        Infinity,
        { environmentIds: source.live, qualifyCoverage: true },
      )
    : null;
  const { now, window } = useDreamClock(quotas?.providers.map((provider) => provider.expiresAt));
  const usageIds =
    source.initialized && visibleSlots.some((slot) => slot === "tokens" || slot === "cost")
      ? source.environmentIds
      : EMPTY_ENVIRONMENTS;
  const usage = useUsage(window, usageIds, { querySelectedOnly: true });
  const [cachedUsage, setCachedUsage] = useState<DreamUsageReading | null>(null);
  const reading = resolveDreamUsage(cachedUsage, usageIds, usage, source.live);
  if (reading !== cachedUsage) setCachedUsage(reading);
  const { themeVariablesByAppearance } = useAppearancePreferences();
  const colors = resolveDreamPalette(preferences.palette, themeVariablesByAppearance.dark);
  const live = [...source.environmentIds].filter((id) => source.live.has(id));
  const counts = summarizeDreamThreads(
    source.selected.filter((thread) => source.live.has(thread.environmentId)),
  );
  const connectionState = resolveDreamConnection({
    ready: source.ready,
    configured: source.presentations.size,
    selected: source.environmentIds.size,
    live: live.length,
  });
  const unavailable = connectionState !== "live" && connectionState !== "partial";
  const partial = connectionState === "partial";
  const tightest = resolveDreamQuota(quotas?.providers ?? [], now.getTime(), partial);
  const number = (value: number) => `${partial ? "~" : ""}${value}`;
  const quotaRemaining = tightest ? Math.max(0, Math.min(100, tightest.remaining)) : null;
  const metric = (kpi: DreamKpi) => {
    switch (kpi) {
      case "tokens":
        return {
          value: reading ? `${reading.partial ? "~" : ""}${formatTokens(reading.tokens)}` : "–",
          detail: !reading
            ? usage.isPending
              ? "Updating"
              : "Usage unavailable"
            : reading.refreshing
              ? "Updating"
              : reading.partial
                ? "Partial coverage"
                : "Selected machines",
          alert: false,
        };
      case "cost": {
        if (!reading || reading.costUsd === null) {
          return {
            value: "–",
            detail: usage.isPending ? "Updating · machines" : "Cost unavailable",
            alert: false,
          };
        }
        const partialCost = reading.partial || reading.costPartial;
        let quality = reading.estimated ? "Estimated" : "Reported";
        if (reading.refreshing) {
          quality = reading.estimated ? "Updating estimate" : "Updating";
        } else if (partialCost) {
          quality = reading.estimated ? "Partial estimate" : "Partial";
        }
        return {
          value: `${partialCost ? "~" : ""}${formatUsd(reading.costUsd)}`,
          detail: reading.costPartial ? `${quality} (unpriced usage)` : quality,
          alert: false,
        };
      }
      case "limits":
        return {
          value:
            quotaRemaining === null ? "–" : `${tightest?.partial ? "~" : ""}${quotaRemaining}%`,
          detail:
            tightest && quotaRemaining !== null
              ? `${tightest.partial ? "Partial " : ""}${tightest.name} ${tightest.label}`
              : "No quota available",
          alert: quotaRemaining !== null && quotaRemaining <= 10,
          progress: quotaRemaining,
        };
      case "connections":
        return {
          value: `${live.length}/${source.environmentIds.size}`,
          detail: "Connected",
          alert: false,
        };
      case "working":
      case "input":
      case "questions":
      case "finished":
      case "failed":
        return {
          value: number(counts[kpi]),
          detail: kpi === "finished" ? "Not yet viewed" : "Selected sessions",
          alert: kpi === "failed" && counts.failed > 0,
        };
      default:
        return { value: "", detail: "", alert: false };
    }
  };
  const connection = {
    loading: {
      text: "Connecting…",
      title: "Connecting…",
      detail: "Waiting for live session status.",
      color: STATUS_COLORS.idle,
    },
    unconfigured: {
      text: "Not connected",
      title: "Connect your first machine",
      detail: "Connect a machine in Settings → Environments. Your sessions will appear here.",
      color: STATUS_COLORS.idle,
    },
    unselected: {
      text: "Nothing selected",
      title: "Choose sessions to follow",
      detail:
        "Open Desk dashboard settings and choose projects or sessions, or turn on All projects and sessions.",
      color: STATUS_COLORS.idle,
    },
    offline: {
      text: "Offline",
      title: "Waiting for a connection",
      detail: "Live status will return when your selected machines reconnect.",
      color: STATUS_COLORS.down,
    },
    partial: {
      text: `${live.length} of ${source.environmentIds.size} machines live`,
      title: "",
      detail: "",
      color: STATUS_COLORS.partial,
    },
    live: {
      text: `Live · ${live.length} ${live.length === 1 ? "machine" : "machines"}`,
      title: "",
      detail: "",
      color: STATUS_COLORS.live,
    },
  }[connectionState];
  return (
    <DreamScene
      preferences={preferences}
      now={now}
      colors={colors}
      counts={counts}
      connection={connection}
      unavailable={unavailable}
      partial={partial}
      metric={metric}
    />
  );
}
