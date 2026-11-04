import { RegistryContext } from "@effect/atom-react";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { appAtomRegistry } from "../../state/atom-registry";
import { useUsage } from "../../state/usage";
import {
  DREAM_DIM_OPACITY,
  DREAM_KPIS,
  summarizeDreamThreads,
  type DreamKpi,
  type DreamPalette,
} from "../../lib/dreamDashboard";
import { themeColorWithAlpha } from "../../lib/mobileTheme";
import {
  AppearancePreferencesProvider,
  installAppearanceRuntime,
  useAppearancePreferences,
} from "../settings/appearance/AppearancePreferencesProvider";
import { buildSubscriptionUsageSnapshot } from "../../widgets/subscriptionUsageSnapshot";
import { installSubscriptionUsageRefresh } from "../../widgets/useSubscriptionUsage";
import { useDreamClock, useDreamSources } from "./useDreamDashboard";
import { CloudAuthProvider } from "../cloud/CloudAuthProvider";
import { useAppStartupReady } from "../../AppStartup";
import "../../../global.css";

const native = requireOptionalNativeModule<{ is24HourFormat(): boolean }>("T3NativeControls");

const AMBER = {
  "--color-screen": "#110c06",
  "--color-card": "#1e1610",
  "--color-foreground": "#f6dcae",
  "--color-foreground-secondary": "#a9855a",
  "--color-primary": "#ffb454",
} as const;
const MONO = {
  "--color-screen": "#121212",
  "--color-card": "#222222",
  "--color-foreground": "#e8e8e8",
  "--color-foreground-secondary": "#a8a8a8",
  "--color-primary": "#e8e8e8",
} as const;
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

function resolvePalette(
  palette: DreamPalette,
  base: ReturnType<typeof useAppearancePreferences>["themeVariablesByAppearance"]["dark"],
) {
  const overrides = palette === "mono" ? MONO : palette === "amber" ? AMBER : null;
  const colors = overrides ? { ...base, ...overrides } : base;
  return {
    screen: colors["--color-screen"],
    card: colors["--color-card"],
    foreground: colors["--color-foreground"],
    secondary: colors["--color-foreground-secondary"],
    accent: colors["--color-primary"],
    // Muted palettes keep warnings legible without adding a second hue.
    alert:
      palette === "theme"
        ? "#f87171"
        : palette === "amber"
          ? "#ff8a5c"
          : colors["--color-foreground"],
  };
}

export function DreamDashboard() {
  const source = useDreamSources();
  const { preferences } = source;
  const { now, window } = useDreamClock();
  const usage = useUsage(window, source.environmentIds);
  const { themeVariablesByAppearance, isReady } = useAppearancePreferences();
  useAppStartupReady(isReady);
  const colors = resolvePalette(preferences.palette, themeVariablesByAppearance.dark);
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns appearance and quota refresh while the standalone dream surface is mounted
  useEffect(() => {
    const releaseAppearance = installAppearanceRuntime();
    const releaseUsage = installSubscriptionUsageRefresh(() => true);
    return () => {
      releaseUsage();
      releaseAppearance();
    };
  }, []);

  const number = (value: number) => (unavailable ? "N/A" : `${partial ? "~" : ""}${value}`);
  const quotaRemaining =
    tightest && !unavailable && !partial ? Math.max(0, Math.min(100, tightest.remaining)) : null;
  const metric = (kpi: DreamKpi) => {
    switch (kpi) {
      case "tokens":
        return {
          value: usageReady ? formatTokens(usage.merged.totalTokens) : "N/A",
          detail: "Selected machines",
          alert: false,
        };
      case "cost":
        return {
          value:
            usageReady && usage.merged.costQuality.unpricedShare === 0
              ? formatUsd(usage.merged.costUsd)
              : "N/A",
          detail: usage.merged.costQuality.modelPricedShare > 0 ? "Estimated" : "Reported",
          alert: false,
        };
      case "limits":
        return {
          value: quotaRemaining === null ? "N/A" : `${quotaRemaining}%`,
          detail: tightest ? `${tightest.name} · ${tightest.label}` : "No quota available",
          alert: quotaRemaining !== null && quotaRemaining <= 10,
        };
      case "connections":
        return {
          value: `${live.length}/${source.environmentIds.size}`,
          detail: "Machines ready",
          alert: source.environmentIds.size > 0 && live.length === 0,
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
  const needsYou = (kpi: "input" | "questions") => !unavailable && counts[kpi] > 0;
  const card = (kpi: DreamKpi, index: number, large: boolean) => {
    if (kpi === "") return <View key={index} style={styles.card} />;
    const value = metric(kpi);
    const attention =
      kpi === "status"
        ? needsYou("input") || needsYou("questions") || counts.failed > 0
        : kpi === "input" || kpi === "questions"
          ? needsYou(kpi)
          : value.alert;
    const valueColor = value.alert
      ? colors.alert
      : (kpi === "input" || kpi === "questions") && needsYou(kpi)
        ? colors.accent
        : colors.foreground;
    return (
      <View
        key={index}
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            padding: compact ? 14 : large ? 28 : 20,
            borderColor: attention
              ? themeColorWithAlpha(colors.accent, 0.55)
              : themeColorWithAlpha(colors.foreground, 0.06),
          },
        ]}
      >
        <View style={styles.cardLabel}>
          <Text
            numberOfLines={1}
            style={[styles.label, { color: colors.secondary, fontSize: large ? 14 : 12 }]}
          >
            {DREAM_KPIS[kpi]}
          </Text>
          {attention ? (
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: value.alert || counts.failed > 0 ? colors.alert : colors.accent,
                },
              ]}
            />
          ) : null}
        </View>
        {kpi === "status" ? (
          <View style={styles.statusGrid}>
            {(["working", "input", "questions", "finished"] as const).map((key) => (
              <View key={key} style={styles.statusCell}>
                <Text
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  style={[
                    styles.number,
                    {
                      color:
                        (key === "input" || key === "questions") && needsYou(key)
                          ? colors.accent
                          : colors.foreground,
                      fontSize: large ? (compact ? 40 : 56) : compact ? 24 : 30,
                    },
                  ]}
                >
                  {number(counts[key])}
                </Text>
                <Text style={{ color: colors.secondary, fontSize: large ? 14 : 11 }}>
                  {DREAM_KPIS[key]}
                </Text>
              </View>
            ))}
            {large && !unavailable && counts.waiting + counts.failed + counts.limited > 0 ? (
              <Text numberOfLines={1} style={{ color: colors.secondary, fontSize: 13 }}>
                {counts.waiting} waiting ·{" "}
                <Text style={counts.failed > 0 ? { color: colors.alert } : undefined}>
                  {counts.failed} failed
                </Text>{" "}
                · {counts.limited} limited
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.cardValue}>
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              style={[
                styles.number,
                {
                  color: valueColor,
                  fontSize: large ? (compact ? 56 : 88) : compact ? 30 : 42,
                },
              ]}
            >
              {value.value}
            </Text>
            {kpi === "limits" && quotaRemaining !== null ? (
              <View
                style={[
                  styles.track,
                  { backgroundColor: themeColorWithAlpha(colors.foreground, 0.12) },
                ]}
              >
                <View
                  style={[
                    styles.fill,
                    {
                      width: `${quotaRemaining}%`,
                      backgroundColor: value.alert ? colors.alert : colors.accent,
                    },
                  ]}
                />
              </View>
            ) : null}
            <Text numberOfLines={1} style={{ color: colors.secondary, fontSize: large ? 14 : 11 }}>
              {value.detail}
            </Text>
          </View>
        )}
      </View>
    );
  };
  const connection = !source.ready
    ? { text: "Connecting…", color: STATUS_COLORS.idle }
    : source.environmentIds.size === 0
      ? { text: "Pick projects in Settings › Desk dashboard", color: STATUS_COLORS.idle }
      : live.length === 0
        ? { text: "Status unavailable", color: STATUS_COLORS.down }
        : partial
          ? { text: "Partial · some machines unavailable", color: STATUS_COLORS.partial }
          : { text: "Live", color: STATUS_COLORS.live };
  const hour12 =
    preferences.clock === "system"
      ? !(native?.is24HourFormat() ?? true)
      : preferences.clock === "12";
  const minute = now.getMinutes();
  const shift = preferences.pixelShift
    ? [{ translateX: (minute % 2) * 2 }, { translateY: (Math.floor(minute / 2) % 2) * 2 }]
    : [];
  return (
    <View
      onLayout={({ nativeEvent }) => setSize(nativeEvent.layout)}
      style={[
        styles.root,
        { backgroundColor: colors.screen, padding: compact ? 16 : 28, gap: compact ? 12 : 20 },
      ]}
    >
      <View style={[styles.header, { transform: shift }]}>
        <View>
          <Text
            style={{
              color: colors.foreground,
              fontSize: compact ? 40 : 56,
              fontWeight: "200",
              fontVariant: ["tabular-nums"],
              includeFontPadding: false,
            }}
          >
            {now.toLocaleTimeString(undefined, {
              hour: hour12 ? "numeric" : "2-digit",
              minute: "2-digit",
              hour12,
            })}
          </Text>
          {preferences.showDate ? (
            <Text style={{ color: colors.secondary, fontSize: compact ? 14 : 18 }}>
              {now.toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </Text>
          ) : null}
        </View>
        {preferences.showStatus ? (
          <View
            style={[styles.pill, { backgroundColor: themeColorWithAlpha(colors.foreground, 0.08) }]}
          >
            <View style={[styles.dot, { backgroundColor: connection.color }]} />
            <Text
              numberOfLines={1}
              style={{ color: colors.secondary, fontSize: 13, flexShrink: 1 }}
            >
              {connection.text}
            </Text>
          </View>
        ) : null}
      </View>
      <View
        style={[styles.dashboard, { flexDirection: wide ? "row" : "column", transform: shift }]}
      >
        <View style={{ flex: wide ? 1.15 : 1 }}>{card(preferences.slots[0]!, 0, true)}</View>
        <View style={[styles.smallGrid, { flex: wide ? 1 : 1.15 }]}>
          {[0, 1].map((row) => (
            <View key={row} style={styles.smallRow}>
              {preferences.slots
                .slice(1 + row * 2, 3 + row * 2)
                .map((kpi, column) => card(kpi, 1 + row * 2 + column, false))}
            </View>
          ))}
        </View>
      </View>
      {preferences.brightness !== "full" ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "#000", opacity: DREAM_DIM_OPACITY[preferences.brightness] },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexShrink: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dashboard: { flex: 1, gap: 14 },
  card: {
    flex: 1,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "transparent",
    justifyContent: "space-between",
    gap: 6,
    overflow: "hidden",
  },
  cardLabel: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { letterSpacing: 0.8, textTransform: "uppercase", flexShrink: 1 },
  cardValue: { gap: 8 },
  number: { fontWeight: "300", fontVariant: ["tabular-nums"], flexShrink: 1 },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  smallGrid: { gap: 14 },
  smallRow: { flex: 1, flexDirection: "row", gap: 14 },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", flex: 1, alignContent: "center" },
  statusCell: { width: "50%", paddingVertical: 4 },
});
