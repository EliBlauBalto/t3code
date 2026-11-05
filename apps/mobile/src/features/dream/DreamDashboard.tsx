import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { appAtomRegistry } from "../../state/atom-registry";
import { useUsage } from "../../state/usage";
import {
  DREAM_DIM_OPACITY,
  DREAM_KPIS,
  dreamClockFontSize,
  dreamTileScale,
  dreamVisibleSlots,
  resolveDreamQuota,
  resolveDreamConnection,
  summarizeDreamThreads,
  type DreamKpi,
  type DreamPalette,
  type DreamPreferences,
} from "../../lib/dreamDashboard";
import { themeColorWithAlpha } from "../../lib/mobileTheme";
import { resolveDreamUsage, type DreamUsageReading } from "../../lib/dreamUsage";
import { dreamControls } from "../../lib/dreamSupport";
import {
  AppearancePreferencesProvider,
  useAppearancePreferences,
} from "../settings/appearance/AppearancePreferencesProvider";
import { buildSubscriptionUsageSnapshot } from "../../widgets/subscriptionUsageSnapshot";
import { installSubscriptionUsageRefresh } from "../../widgets/useSubscriptionUsage";
import { useDreamClock, useDreamSources } from "./useDreamDashboard";
import { CloudAuthProvider } from "../cloud/CloudAuthProvider";
import { useAppStartupReady } from "../../AppStartup";
import "../../../global.css";

const EMPTY_ENVIRONMENTS: ReadonlySet<EnvironmentId> = new Set();

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
const STATUS_KPIS = ["working", "input", "questions", "finished"] as const;

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
  const quotaScope =
    source.initialized &&
    source.environmentIds.size > 0 &&
    dreamVisibleSlots(source.preferences).includes("limits")
      ? JSON.stringify([...source.environmentIds].sort())
      : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes selected-machine quota only while its native dream tile is visible
  useEffect(() => {
    if (quotaScope === null) return;
    return installSubscriptionUsageRefresh(
      () => true,
      new Set(JSON.parse(quotaScope) as EnvironmentId[]),
    );
  }, [quotaScope]);
  return <DreamDisplay source={source} />;
}

function DreamTile({
  kpi,
  large,
  focused,
  scale,
  fontScale,
  colors,
  counts,
  unavailable,
  partial,
  value,
}: {
  readonly kpi: DreamKpi;
  readonly large: boolean;
  readonly focused: boolean;
  readonly scale: number;
  readonly fontScale: number;
  readonly colors: ReturnType<typeof resolvePalette>;
  readonly counts: ReturnType<typeof summarizeDreamThreads>;
  readonly unavailable: boolean;
  readonly partial: boolean;
  readonly value: {
    readonly value: string;
    readonly detail: string;
    readonly alert: boolean;
    readonly progress?: number | null;
  };
}) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  const number = (value: number) => (unavailable ? "–" : `${partial ? "~" : ""}${value}`);
  const needsYou = (kpi: "input" | "questions") => !unavailable && counts[kpi] > 0;
  if (kpi === "") return <View style={styles.card} />;
  const tileScale = dreamTileScale(scale, size, large, fontScale);
  const compactStatus = kpi === "status" && !large;
  const danger = value.alert || (kpi === "status" && counts.failed > 0);
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
      accessible={compactStatus}
      accessibilityLabel={
        compactStatus
          ? `Session status. ${STATUS_KPIS.map((key) => `${DREAM_KPIS[key]} ${number(counts[key])}`).join(". ")}${counts.failed > 0 ? `. ${number(counts.failed)} failed` : ""}`
          : undefined
      }
      onLayout={({ nativeEvent: { layout } }) =>
        setSize((current) =>
          current?.width === layout.width && current?.height === layout.height
            ? current
            : { width: layout.width, height: layout.height },
        )
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
          padding: Math.round((large ? 26 : 16) * tileScale),
          gap: focused ? 16 : large ? 6 : Math.max(2, Math.round(6 * tileScale)),
          justifyContent: focused ? "center" : "space-between",
          borderWidth: focused ? 0 : 1,
          borderColor: attention
            ? themeColorWithAlpha(danger ? colors.alert : colors.accent, 0.55)
            : themeColorWithAlpha(colors.foreground, 0.07),
        },
      ]}
    >
      {!compactStatus ? (
        <View style={[styles.cardLabel, focused && styles.focusLabel]}>
          <Text
            numberOfLines={1}
            style={[
              styles.label,
              { color: colors.secondary, fontSize: Math.max(11, (large ? 13 : 11) * tileScale) },
            ]}
          >
            {DREAM_KPIS[kpi]}
          </Text>
          {attention ? (
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: danger ? colors.alert : colors.accent,
                },
              ]}
            />
          ) : null}
        </View>
      ) : null}
      {kpi === "status" ? (
        <View
          style={[
            styles.statusGrid,
            compactStatus && styles.compactStatusGrid,
            focused && styles.focusStatusGrid,
          ]}
        >
          {STATUS_KPIS.map((key) => (
            <View
              key={key}
              style={[
                styles.statusCell,
                compactStatus && styles.compactStatusCell,
                focused && styles.focusStatusCell,
              ]}
            >
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
                    fontSize: compactStatus
                      ? Math.max(11, 20 * tileScale)
                      : (large ? 60 : 30) * tileScale,
                    fontWeight: compactStatus ? "500" : "300",
                  },
                ]}
              >
                {number(counts[key])}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  {
                    color: colors.secondary,
                    fontSize: Math.max(11, (large ? 14 : 11) * tileScale),
                  },
                  compactStatus && styles.compactStatusText,
                ]}
              >
                {DREAM_KPIS[key]}
              </Text>
            </View>
          ))}
          {large && !unavailable && counts.waiting + counts.failed + counts.limited > 0 ? (
            <Text
              numberOfLines={1}
              style={{
                color: colors.secondary,
                fontSize: Math.max(11, 13 * tileScale),
                width: "100%",
                textAlign: focused ? "center" : "left",
              }}
            >
              {number(counts.waiting)} waiting ·{" "}
              <Text style={counts.failed > 0 ? { color: colors.alert } : undefined}>
                {number(counts.failed)} failed
              </Text>{" "}
              · {number(counts.limited)} limited
            </Text>
          ) : null}
        </View>
      ) : (
        <View
          style={[
            styles.cardValue,
            !large && { gap: Math.max(2, Math.round(4 * tileScale)) },
            focused && styles.focusValue,
          ]}
        >
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
          {kpi === "limits" && typeof value.progress === "number" ? (
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
                    width: `${value.progress}%`,
                    backgroundColor: value.alert ? colors.alert : colors.accent,
                  },
                ]}
              />
            </View>
          ) : null}
          <Text
            numberOfLines={1}
            style={{
              color: colors.secondary,
              fontSize: Math.max(10, (large ? 13 : 11) * tileScale),
              textAlign: focused ? "center" : "left",
            }}
          >
            {value.detail}
          </Text>
        </View>
      )}
    </View>
  );
}

function DreamClockFace({
  preferences,
  now,
  size,
  colors,
  scale,
}: {
  readonly preferences: DreamPreferences;
  readonly now: Date;
  readonly size: { readonly width: number; readonly height: number };
  readonly colors: ReturnType<typeof resolvePalette>;
  readonly scale: number;
}) {
  const clockOnly = preferences.layout === "clock";
  const hour12 =
    preferences.clock === "system"
      ? !(dreamControls?.is24HourFormat?.() ?? true)
      : preferences.clock === "12";
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
  return (
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
              fontSize: Math.max(11, (clockOnly ? 20 : 13) * scale),
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
          style={{
            color: colors.secondary,
            fontSize: Math.max(12, 15 * scale),
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
  );
}

export function DreamDisplay({ source }: { readonly source: ReturnType<typeof useDreamSources> }) {
  const { preferences } = source;
  const visibleSlots = dreamVisibleSlots(preferences);
  const quotas = visibleSlots.includes("limits")
    ? buildSubscriptionUsageSnapshot(
        new Map([...source.presentations].filter(([id]) => source.environmentIds.has(id))),
        "",
        Infinity,
        source.live,
      )
    : null;
  const { now, window } = useDreamClock(quotas?.providers.map((provider) => provider.expiresAt));
  const usageIds =
    source.initialized && visibleSlots.some((slot) => slot === "tokens" || slot === "cost")
      ? source.environmentIds
      : EMPTY_ENVIRONMENTS;
  const usage = useUsage(window, usageIds, { querySelectedOnly: true });
  const [cachedUsage, setCachedUsage] = useState<DreamUsageReading | null>(null);
  const reading = resolveDreamUsage(cachedUsage, usageIds, usage);
  if (reading !== cachedUsage) setCachedUsage(reading);
  const { themeVariablesByAppearance } = useAppearancePreferences();
  const colors = resolvePalette(preferences.palette, themeVariablesByAppearance.dark);
  const [size, setSize] = useState({ width: 0, height: 0 });
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
    configured: source.presentations.size,
    selected: source.environmentIds.size,
    live: live.length,
  });
  const unavailable = connectionState !== "live" && connectionState !== "partial";
  const partial = connectionState === "partial";
  const tightest = resolveDreamQuota(quotas?.providers ?? [], now.getTime(), partial);
  const number = (value: number) => (unavailable ? "–" : `${partial ? "~" : ""}${value}`);
  const quotaRemaining =
    tightest && !unavailable ? Math.max(0, Math.min(100, tightest.remaining)) : null;
  const metric = (kpi: DreamKpi) => {
    switch (kpi) {
      case "tokens":
        return {
          value: reading ? `${reading.partial ? "~" : ""}${formatTokens(reading.tokens)}` : "–",
          detail: !reading
            ? usage.isPending
              ? "Updating · selected machines"
              : "Usage unavailable"
            : reading.refreshing
              ? "Updating · selected machines"
              : reading.partial
                ? "Partial · selected machines"
                : "Selected machines",
          alert: false,
        };
      case "cost": {
        if (!reading || reading.costUsd === null) {
          return {
            value: "–",
            detail: usage.isPending ? "Updating · selected machines" : "Cost unavailable",
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
          detail: `${quality} · ${reading.costPartial ? "unpriced usage" : "selected machines"}`,
          alert: false,
        };
      }
      case "limits":
        return {
          value:
            quotaRemaining === null ? "–" : `${tightest?.partial ? "~" : ""}${quotaRemaining}%`,
          detail:
            tightest && quotaRemaining !== null
              ? `${tightest.partial ? "Partial · " : ""}${tightest.name} · ${tightest.label}`
              : unavailable
                ? "Waiting for live quota"
                : "No quota available",
          alert: quotaRemaining !== null && quotaRemaining <= 10,
          progress: quotaRemaining,
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
  const card = (kpi: DreamKpi, index: number, large: boolean) => (
    <DreamTile
      key={index}
      kpi={kpi}
      large={large}
      focused={focused}
      scale={scale}
      fontScale={fontScale}
      colors={colors}
      counts={counts}
      unavailable={unavailable}
      partial={partial}
      value={metric(kpi)}
    />
  );
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
  const minute = now.getMinutes();
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
          <DreamClockFace
            preferences={preferences}
            now={now}
            size={size}
            colors={colors}
            scale={scale}
          />
          {preferences.showStatus ? (
            <View style={styles.pill}>
              <View style={[styles.dot, { backgroundColor: connection.color }]} />
              <Text
                numberOfLines={1}
                style={{
                  color: colors.secondary,
                  fontSize: Math.max(11, 12 * scale),
                  flexShrink: 1,
                }}
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
              numberOfLines={3}
              style={{
                color: colors.foreground,
                fontSize: Math.max(18, 28 * scale),
                fontWeight: "300",
                textAlign: "center",
              }}
            >
              {connection.title}
            </Text>
            <Text
              style={{
                color: colors.secondary,
                fontSize: Math.max(12, 15 * scale),
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
              fontSize: Math.max(12, 14 * scale),
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
  focusValue: { justifyContent: "center" },
  focusLabel: { justifyContent: "center" },
  focusStatusGrid: { flex: 0 },
  focusStatusCell: { alignItems: "center" },
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
  number: {
    fontWeight: "300",
    fontVariant: ["tabular-nums"],
    flexShrink: 1,
    includeFontPadding: false,
  },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  smallGrid: { gap: 14 },
  smallRow: { flex: 1, flexDirection: "row", gap: 14 },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", flex: 1, alignContent: "center" },
  statusCell: { width: "50%", paddingVertical: 4 },
  compactStatusGrid: {
    flexDirection: "column",
    flexWrap: "nowrap",
    justifyContent: "space-evenly",
  },
  compactStatusCell: {
    width: "100%",
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 0,
    gap: 4,
  },
  compactStatusText: { includeFontPadding: false, flexShrink: 1 },
});
