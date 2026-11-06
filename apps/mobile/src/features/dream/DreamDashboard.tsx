import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { appAtomRegistry } from "../../state/atom-registry";
import { useUsage } from "../../state/usage";
import {
  DREAM_DIM_OPACITY,
  dreamClockFontSize,
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
import { DreamTile } from "./DreamTile";
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
  const dimensions = useWindowDimensions();
  const [bounds, setBounds] = useState<{ width: number; height: number }>();
  const [body, setBody] = useState<{ key: string; width: number; height: number }>();
  const size = bounds ?? dimensions;
  const { fontScale } = dimensions;
  const wide = size.width >= 600 && size.width > size.height;
  const scale = Math.max(0.65, Math.min(2, Math.min(size.width / 400, size.height / 680)));
  const textSpacing = fontScale >= 1.5 ? fontScale : 1;
  const gap = Math.round((16 * scale) / textSpacing);
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
              ? "Updating · machines"
              : "Usage unavailable"
            : reading.refreshing
              ? "Updating · machines"
              : reading.partial
                ? "Partial · machines"
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
          detail: `${quality} · ${reading.costPartial ? "unpriced usage" : "machines"}`,
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
          detail: "Live",
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
  const bodyKey = `${preferences.layout}:${size.width}:${size.height}:${fontScale}:${connection.text}`;
  const bodySize = body?.key === bodyKey && body.width > 0 && body.height > 0 ? body : undefined;
  const card = (kpi: DreamKpi, index: number) => {
    if (!bodySize) return null;
    const { width, height } = bodySize;
    const hero =
      (wide ? width - gap : height - gap) * (wide ? 1.15 / 2.15 : 1 / (1 + 0.85 * textSpacing));
    const gridWidth = wide ? width - hero - gap : width;
    const gridHeight = wide ? height : height - hero - gap;
    const tileWidth = Math.max(0, (gridWidth - gap) / 2);
    const tileHeight = Math.max(0, (gridHeight - gap) / 2);
    const frame =
      focused || index === 0
        ? {
            left: 0,
            top: 0,
            width: focused || !wide ? width : hero,
            height: focused || wide ? height : hero,
          }
        : {
            left: (wide ? hero + gap : 0) + ((index - 1) % 2) * (tileWidth + gap),
            top: (wide ? 0 : hero + gap) + Math.floor((index - 1) / 2) * (tileHeight + gap),
            width: tileWidth,
            height: tileHeight,
          };
    return (
      <DreamTile
        key={index}
        kpi={kpi}
        large={index === 0}
        focused={focused}
        frame={frame}
        scale={scale}
        fontScale={fontScale}
        colors={colors}
        counts={counts}
        unavailable={unavailable}
        partial={partial}
        value={metric(kpi)}
      />
    );
  };
  const minute = now.getMinutes();
  const shift = preferences.pixelShift
    ? [
        { translateX: minute % 2 === 0 ? -8 : 8 },
        { translateY: Math.floor(minute / 2) % 2 === 0 ? -8 : 8 },
      ]
    : [];
  return (
    <View
      onLayout={({ nativeEvent: { layout } }) =>
        setBounds((current) =>
          current?.width === layout.width && current?.height === layout.height
            ? current
            : { width: layout.width, height: layout.height },
        )
      }
      style={[
        styles.root,
        {
          backgroundColor: colors.screen,
          padding:
            Math.max(16, Math.round((28 * scale) / textSpacing)) + (preferences.pixelShift ? 8 : 0),
        },
      ]}
    >
      {bounds ? (
        <View
          // Preserve the native parent when measurement changes opacity and Fabric flattens views.
          collapsable={false}
          style={[
            styles.content,
            { gap: gap * 1.5, opacity: unavailable || clockOnly || bodySize ? 1 : 0 },
          ]}
        >
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
              {unavailable ? (
                connection.title
              ) : (
                <>
                  {`${number(counts.working)}\u00a0working · ${number(counts.input + counts.questions)}\u00a0need\u00a0you · ${number(counts.finished)}\u00a0finished`}
                  {counts.failed > 0 ? (
                    <Text style={{ color: colors.alert }}>
                      {` · ${number(counts.failed)}\u00a0failed`}
                    </Text>
                  ) : null}
                </>
              )}
            </Text>
          ) : (
            <View
              key={bodyKey}
              onLayout={({ nativeEvent: { layout } }) =>
                setBody((current) =>
                  current?.key === bodyKey &&
                  current.width === layout.width &&
                  current.height === layout.height
                    ? current
                    : { key: bodyKey, width: layout.width, height: layout.height },
                )
              }
              style={[focused ? styles.focus : styles.dashboard, { transform: shift }]}
            >
              {preferences.slots.slice(0, focused ? 1 : 5).map(card)}
            </View>
          )}
        </View>
      ) : null}
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
  dashboard: { flex: 1 },
});
