import { RegistryContext } from "@effect/atom-react";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { appAtomRegistry } from "../../state/atom-registry";
import { useUsage } from "../../state/usage";
import { DREAM_KPIS, summarizeDreamThreads, type DreamKpi } from "../../lib/dreamDashboard";
import {
  AppearancePreferencesProvider,
  useAppearancePreferences,
} from "../settings/appearance/AppearancePreferencesProvider";
import { buildSubscriptionUsageSnapshot } from "../../widgets/subscriptionUsageSnapshot";
import { installSubscriptionUsageRefresh } from "../../widgets/useSubscriptionUsage";
import { useDreamClock, useDreamSources } from "./useDreamDashboard";
import { CloudAuthProvider } from "../cloud/CloudAuthProvider";

const native = requireOptionalNativeModule<{ is24HourFormat(): boolean }>("T3NativeControls");

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
  const { now, window } = useDreamClock();
  const usage = useUsage(window, source.environmentIds);
  const { themeVariablesByAppearance } = useAppearancePreferences();
  const colors = source.preferences.monochrome
    ? {
        ...themeVariablesByAppearance.dark,
        "--color-screen": "#141414",
        "--color-card": "#242424",
        "--color-foreground": "#e6e6e6",
        "--color-foreground-secondary": "#bdbdbd",
        "--color-primary": "#e6e6e6",
      }
    : themeVariablesByAppearance.dark;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const wide = size.width > size.height;
  const compact = size.height < 480;
  const live = [...source.environmentIds].filter((id) => source.live.has(id));
  const counts = summarizeDreamThreads(
    source.selected.filter((thread) => source.live.has(thread.environmentId)),
  );
  const unavailable = !source.ready || live.length === 0;
  const partial = live.length < source.environmentIds.size;
  const usageReady =
    source.environmentIds.size > 0 &&
    usage.selectedEnvironments.length === source.environmentIds.size &&
    usage.merged.contractMismatches.length === 0 &&
    usage.selectedEnvironments.every(
      (entry) =>
        entry.isConnected &&
        entry.summary !== null &&
        !entry.isPending &&
        entry.summary.sources.length > 0 &&
        entry.summary.sources.every((item) => item.status === "ok" && item.refreshing !== true),
    );
  const quotas = buildSubscriptionUsageSnapshot(
    new Map([...source.presentations].filter(([id]) => source.environmentIds.has(id))),
    "",
    Infinity,
  );
  const tightest = quotas.providers
    .flatMap((provider) =>
      provider.expiresAt > now.getTime()
        ? provider.windows.map((limit) => ({ name: provider.name, ...limit }))
        : [],
    )
    .sort((a, b) => a.remaining - b.remaining)[0];
  const accent = source.preferences.monochrome
    ? colors["--color-foreground"]
    : colors["--color-primary"];
  const foreground = colors["--color-foreground"];
  const secondary = colors["--color-foreground-secondary"];
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reuses the existing quota refresher only for the lifetime of the visible dream
  useEffect(() => installSubscriptionUsageRefresh(() => true), []);

  const number = (value: number) => (unavailable ? "N/A" : `${partial ? "~" : ""}${value}`);
  const metric = (kpi: DreamKpi) => {
    switch (kpi) {
      case "tokens":
        return {
          value: usageReady ? formatTokens(usage.merged.totalTokens) : "N/A",
          detail: "Selected machines · 24h",
        };
      case "cost":
        return {
          value:
            usageReady && usage.merged.costQuality.unpricedShare === 0
              ? formatUsd(usage.merged.costUsd)
              : "N/A",
          detail:
            usage.merged.costQuality.modelPricedShare > 0
              ? "Estimated · selected machines"
              : "Reported · selected machines",
        };
      case "limits":
        return {
          value: tightest && !unavailable && !partial ? `${tightest.remaining}%` : "N/A",
          detail: tightest ? `${tightest.name} · ${tightest.label}` : "No quota available",
        };
      case "connections":
        return {
          value: `${live.length}/${source.environmentIds.size}`,
          detail: "Machines ready",
        };
      case "working":
      case "input":
      case "questions":
      case "finished":
      case "failed":
        return {
          value: number(counts[kpi]),
          detail: kpi === "finished" ? "Not yet viewed" : "Selected sessions",
        };
      default:
        return { value: "", detail: "" };
    }
  };
  const card = (kpi: DreamKpi, index: number, large: boolean) => {
    if (kpi === "") return <View key={index} style={styles.card} />;
    const value = metric(kpi);
    return (
      <View
        key={index}
        style={[
          styles.card,
          { backgroundColor: colors["--color-card"], padding: compact ? 12 : 20 },
        ]}
      >
        <Text numberOfLines={1} style={{ color: secondary, fontSize: large ? 18 : 14 }}>
          {DREAM_KPIS[kpi]}
        </Text>
        {kpi === "status" ? (
          <View style={styles.statusGrid}>
            {(["working", "input", "questions", "finished"] as const).map((key) => (
              <View key={key} style={styles.statusCell}>
                <Text
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  style={{
                    color:
                      (key === "input" || key === "questions") && counts[key] > 0
                        ? accent
                        : foreground,
                    fontSize: compact ? 28 : large ? 52 : 28,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {number(counts[key])}
                </Text>
                <Text style={{ color: secondary, fontSize: large ? 14 : 11 }}>
                  {DREAM_KPIS[key]}
                </Text>
              </View>
            ))}
            {large && counts.waiting + counts.failed + counts.limited > 0 ? (
              <Text numberOfLines={1} style={{ color: secondary, fontSize: 12 }}>
                {counts.waiting} waiting · {counts.failed} failed · {counts.limited} limited
              </Text>
            ) : null}
          </View>
        ) : (
          <>
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              style={{
                color: foreground,
                fontSize: compact ? 30 : large ? 80 : 38,
                fontVariant: ["tabular-nums"],
                flexShrink: 1,
              }}
            >
              {value.value}
            </Text>
            <Text numberOfLines={1} style={{ color: secondary, fontSize: 11 }}>
              {value.detail}
            </Text>
          </>
        )}
      </View>
    );
  };
  const status = !source.ready
    ? "Connecting…"
    : source.environmentIds.size === 0
      ? "Choose projects or sessions in Settings"
      : live.length === 0
        ? "Status unavailable"
        : partial
          ? "Partial · some machines unavailable"
          : "Live";
  return (
    <View
      onLayout={({ nativeEvent }) => setSize(nativeEvent.layout)}
      style={[
        styles.root,
        { backgroundColor: colors["--color-screen"], padding: compact ? 16 : 24 },
      ]}
    >
      <View style={styles.header}>
        <Text
          style={{ color: secondary, fontSize: compact ? 28 : 40, fontVariant: ["tabular-nums"] }}
        >
          {now.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            hour12: !(native?.is24HourFormat() ?? true),
          })}
        </Text>
        <Text numberOfLines={1} style={{ color: secondary, fontSize: 12, flexShrink: 1 }}>
          {status}
        </Text>
      </View>
      <View
        style={[
          styles.dashboard,
          {
            flexDirection: wide ? "row" : "column",
            transform: [{ translateX: now.getMinutes() % 2 === 0 ? 0 : 2 }],
          },
        ]}
      >
        <View style={{ flex: wide ? 1.15 : 1 }}>{card(source.preferences.slots[0]!, 0, true)}</View>
        <View style={[styles.smallGrid, { flex: wide ? 1 : 1.15 }]}>
          {[0, 1].map((row) => (
            <View key={row} style={styles.smallRow}>
              {source.preferences.slots
                .slice(1 + row * 2, 3 + row * 2)
                .map((kpi, column) => card(kpi, 1 + row * 2 + column, false))}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16 },
  dashboard: { flex: 1, gap: 12 },
  card: { flex: 1, borderRadius: 28, justifyContent: "space-evenly", gap: 6, overflow: "hidden" },
  smallGrid: { gap: 12 },
  smallRow: { flex: 1, flexDirection: "row", gap: 12 },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", flex: 1, alignContent: "center" },
  statusCell: { width: "50%", paddingVertical: 4 },
});
