import { RegistryContext } from "@effect/atom-react";
import { useEffect, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { appAtomRegistry } from "../../state/atom-registry";
import { useUsage } from "../../state/usage";
import {
  DREAM_DIM_OPACITY,
  DREAM_KPIS,
  dreamClockFontSize,
  dreamTileScale,
  resolveDreamConnection,
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
  const { isReady } = useAppearancePreferences();
  useAppStartupReady(isReady);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns appearance and quota refresh while the standalone dream surface is mounted
  useEffect(() => {
    const releaseAppearance = installAppearanceRuntime();
    const releaseUsage = installSubscriptionUsageRefresh(() => true);
    return () => {
      releaseUsage();
      releaseAppearance();
    };
  }, []);
  return <DreamDisplay source={source} />;
}

export function DreamDisplay({ source }: { readonly source: ReturnType<typeof useDreamSources> }) {
  const { preferences } = source;
  const { now, window } = useDreamClock();
  const usage = useUsage(window, source.environmentIds);
  const { themeVariablesByAppearance } = useAppearancePreferences();
  const colors = resolvePalette(preferences.palette, themeVariablesByAppearance.dark);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [tileSizes, setTileSizes] = useState<Record<number, { width: number; height: number }>>({});
  const { fontScale } = useWindowDimensions();
  const wide = size.width >= 600 && size.width > size.height;
  const scale = Math.max(0.65, Math.min(1.35, Math.min(size.width / 400, size.height / 680)));
  const gap = Math.round(16 * scale);
  const clockOnly = preferences.layout === "clock";
  const focused = preferences.layout === "focus";
  const live = [...source.environmentIds].filter((id) => source.live.has(id));
  const counts = summarizeDreamThreads(
    source.selected.filter((thread) => source.live.has(thread.environmentId)),
  );
  const connectionState = resolveDreamConnection({
    ready: source.ready,
    configured: [...source.presentations.values()].filter((entry) => entry.entry.enabled).length,
    selected: source.environmentIds.size,
    live: live.length,
  });
  const unavailable = connectionState !== "live" && connectionState !== "partial";
  const partial = connectionState === "partial";
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
  const number = (value: number) => (unavailable ? "–" : `${partial ? "~" : ""}${value}`);
  const quotaRemaining =
    tightest && !unavailable && !partial ? Math.max(0, Math.min(100, tightest.remaining)) : null;
  const metric = (kpi: DreamKpi) => {
    switch (kpi) {
      case "tokens":
        return {
          value: usageReady ? formatTokens(usage.merged.totalTokens) : "–",
          detail: usageReady ? "Selected machines" : "Usage unavailable",
          alert: false,
        };
      case "cost":
        return {
          value:
            usageReady && usage.merged.costQuality.unpricedShare === 0
              ? formatUsd(usage.merged.costUsd)
              : "–",
          detail:
            !usageReady || usage.merged.costQuality.unpricedShare > 0
              ? "Cost unavailable"
              : usage.merged.costQuality.modelPricedShare > 0
                ? "Estimated · selected machines"
                : "Reported · selected machines",
          alert: false,
        };
      case "limits":
        return {
          value: quotaRemaining === null ? "–" : `${quotaRemaining}%`,
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
    const tileScale = dreamTileScale(scale, tileSizes[index], large, fontScale);
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
        onLayout={({ nativeEvent: { layout } }) =>
          setTileSizes((current) => {
            if (current[index]?.width === layout.width && current[index]?.height === layout.height)
              return current;
            return { ...current, [index]: { width: layout.width, height: layout.height } };
          })
        }
        style={[
          styles.card,
          {
            backgroundColor: focused
              ? "transparent"
              : large
                ? themeColorWithAlpha(colors.accent, attention ? 0.09 : 0.045)
                : colors.card,
            borderRadius: large ? 24 : 18,
            padding: Math.round((large ? 26 : 18) * tileScale),
            borderWidth: focused ? 0 : 1,
            borderColor: attention
              ? themeColorWithAlpha(colors.accent, 0.55)
              : themeColorWithAlpha(colors.foreground, 0.07),
          },
        ]}
      >
        <View style={styles.cardLabel}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[
              styles.label,
              { color: colors.secondary, fontSize: (large ? 13 : 11) * tileScale },
            ]}
          >
            {DREAM_KPIS[kpi]}
          </Text>
          {attention ? (
            <View
              style={[
                styles.dot,
                {
                  backgroundColor:
                    value.alert || (kpi === "status" && counts.failed > 0)
                      ? colors.alert
                      : colors.accent,
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
                          : counts[key] === 0
                            ? colors.secondary
                            : colors.foreground,
                      fontSize: (large ? 60 : 30) * tileScale,
                    },
                  ]}
                >
                  {number(counts[key])}
                </Text>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={{ color: colors.secondary, fontSize: (large ? 14 : 11) * tileScale }}
                >
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
          <View style={[styles.cardValue, focused && styles.focusValue]}>
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              style={[
                styles.number,
                {
                  color: valueColor,
                  fontSize: (large ? (focused ? 116 : 88) : 44) * tileScale,
                  textAlign: focused ? "center" : "left",
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
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{
                color: colors.secondary,
                fontSize: (large ? 13 : 11) * tileScale,
                textAlign: focused ? "center" : "left",
              }}
            >
              {value.detail}
            </Text>
          </View>
        )}
      </View>
    );
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
      detail: "Open T3 Code → Settings → Environments to connect. Your sessions will appear here.",
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
    live: { text: "Live", title: "", detail: "", color: STATUS_COLORS.live },
  }[connectionState];
  const hour12 =
    preferences.clock === "system"
      ? !(native?.is24HourFormat() ?? true)
      : preferences.clock === "12";
  const minute = now.getMinutes();
  const timeParts = new Intl.DateTimeFormat(undefined, {
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12,
  }).formatToParts(now);
  const timeText = timeParts
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
  const dayPeriod = timeParts.find((part) => part.type === "dayPeriod")?.value;
  const shift = preferences.pixelShift
    ? [{ translateX: (minute % 2) * 2 }, { translateY: (Math.floor(minute / 2) % 2) * 2 }]
    : [];
  return (
    <View
      onLayout={({ nativeEvent }) => setSize(nativeEvent.layout)}
      style={[styles.root, { backgroundColor: colors.screen, padding: Math.round(28 * scale) }]}
    >
      <View style={[styles.content, { gap: gap * 1.5, maxHeight: clockOnly ? undefined : 860 }]}>
        <View style={[styles.header, clockOnly && styles.clockHeader, { transform: shift }]}>
          <View style={clockOnly && styles.clockFace}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "baseline",
                justifyContent: clockOnly ? "center" : "flex-start",
              }}
            >
              <Text
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                style={{
                  color: colors.foreground,
                  fontSize: clockOnly ? dreamClockFontSize(size.width, size.height) : 46 * scale,
                  fontWeight: "200",
                  fontVariant: ["tabular-nums"],
                  includeFontPadding: false,
                  textAlign: clockOnly ? "center" : "left",
                  flexShrink: 1,
                  letterSpacing: clockOnly ? -3 : -1,
                }}
              >
                {timeText}
              </Text>
              {dayPeriod ? (
                <Text
                  style={{
                    color: colors.secondary,
                    fontSize: (clockOnly ? 20 : 13) * scale,
                    marginLeft: 8,
                  }}
                >
                  {dayPeriod}
                </Text>
              ) : null}
            </View>
            {preferences.showDate ? (
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{
                  color: colors.secondary,
                  fontSize: 15 * scale,
                  textAlign: clockOnly ? "center" : "left",
                }}
              >
                {now.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </Text>
            ) : null}
          </View>
          {preferences.showStatus ? (
            <View style={styles.pill}>
              <View style={[styles.dot, { backgroundColor: connection.color }]} />
              <Text
                numberOfLines={1}
                style={{ color: colors.secondary, fontSize: 12 * scale, flexShrink: 1 }}
              >
                {connection.text}
              </Text>
            </View>
          ) : null}
        </View>
        {unavailable && !clockOnly ? (
          <View style={[styles.empty, { transform: shift }]}>
            <View
              style={[
                styles.emptyMark,
                { backgroundColor: themeColorWithAlpha(colors.accent, 0.12) },
              ]}
            >
              <View style={[styles.dot, { backgroundColor: colors.accent }]} />
            </View>
            <Text
              numberOfLines={2}
              adjustsFontSizeToFit
              style={{
                color: colors.foreground,
                fontSize: 28 * scale,
                fontWeight: "300",
                textAlign: "center",
              }}
            >
              {connection.title}
            </Text>
            <Text
              style={{
                color: colors.secondary,
                fontSize: 15 * scale,
                lineHeight: 23 * scale,
                textAlign: "center",
                maxWidth: 380,
              }}
            >
              {connection.detail}
            </Text>
          </View>
        ) : clockOnly ? (
          <Text
            numberOfLines={2}
            style={{
              color: colors.secondary,
              textAlign: "center",
              fontSize: 14 * scale,
              paddingVertical: gap,
              borderTopWidth: 1,
              borderTopColor: themeColorWithAlpha(colors.foreground, 0.1),
              transform: shift,
            }}
          >
            {unavailable
              ? connection.title
              : `${number(counts.working)} working · ${number(counts.input + counts.questions)} need you · ${number(counts.finished)} finished`}
          </Text>
        ) : focused ? (
          <View style={[styles.focus, { transform: shift }]}>
            {card(preferences.slots[0]!, 0, true)}
          </View>
        ) : (
          <View
            style={[
              styles.dashboard,
              { flexDirection: wide ? "row" : "column", gap, transform: shift },
            ]}
          >
            <View style={{ flex: wide ? 1.15 : 1 }}>{card(preferences.slots[0]!, 0, true)}</View>
            <View style={[styles.smallGrid, { flex: wide ? 1 : 0.85, gap }]}>
              {[0, 1].map((row) => (
                <View key={row} style={[styles.smallRow, { gap }]}>
                  {preferences.slots
                    .slice(1 + row * 2, 3 + row * 2)
                    .map((kpi, column) => card(kpi, 1 + row * 2 + column, false))}
                </View>
              ))}
            </View>
          </View>
        )}
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
  root: { flex: 1, justifyContent: "center", alignItems: "center" },
  content: { flex: 1, width: "100%", maxWidth: 1120 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  emptyMark: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  focus: {
    flex: 1,
    width: "100%",
    maxWidth: 720,
    maxHeight: 500,
    alignSelf: "center",
    marginVertical: "auto",
  },
  focusValue: { flex: 1, justifyContent: "center" },
  clockHeader: {
    flex: 1,
    flexDirection: "column",
    justifyContent: "center",
    flexWrap: "nowrap",
    gap: 24,
  },
  clockFace: { width: "100%", maxWidth: 720, gap: 8 },
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
    paddingVertical: 6,
    flexShrink: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dashboard: { flex: 1, gap: 14 },
  card: {
    flex: 1,
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
