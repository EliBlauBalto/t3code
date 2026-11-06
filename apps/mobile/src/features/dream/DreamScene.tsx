import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  DREAM_DIM_OPACITY,
  dreamClockFontSize,
  dreamStatusSummary,
  resolveDreamStatus,
  type DreamKpi,
  type DreamPalette,
  type DreamPreferences,
  type summarizeDreamThreads,
} from "../../lib/dreamDashboard";
import { dreamControls } from "../../lib/dreamSupport";
import { themeColorWithAlpha } from "../../lib/mobileTheme";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { DreamTile } from "./DreamTile";
import { useDreamClock } from "./useDreamDashboard";

const AMBER = {
  "--color-screen": "#100c07",
  "--color-card": "#1b1510",
  "--color-foreground": "#f6dcae",
  "--color-foreground-secondary": "#b39a74",
  "--color-primary": "#ffb454",
} as const;
const MONO = {
  "--color-screen": "#090909",
  "--color-card": "#141414",
  "--color-foreground": "#e8e8e8",
  "--color-foreground-secondary": "#a8a8a8",
  "--color-primary": "#e8e8e8",
} as const;

export function resolveDreamPalette(
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
    alert:
      palette === "theme"
        ? "#fb897e"
        : palette === "amber"
          ? "#ffad76"
          : colors["--color-foreground"],
  };
}

type DreamColors = ReturnType<typeof resolveDreamPalette>;
type DreamCounts = ReturnType<typeof summarizeDreamThreads>;
type DreamMetric = {
  readonly value: string;
  readonly detail: string;
  readonly alert: boolean;
  readonly progress?: number | null;
};

function ClockFace({
  preferences,
  now,
  size,
  colors,
  scale,
}: {
  readonly preferences: DreamPreferences;
  readonly now: Date;
  readonly size: { readonly width: number; readonly height: number };
  readonly colors: DreamColors;
  readonly scale: number;
}) {
  const clockOnly = preferences.layout === "clock";
  const focused = preferences.layout === "focus";
  const hour12 =
    preferences.clock === "system"
      ? !(dreamControls?.is24HourFormat?.() ?? true)
      : preferences.clock === "12";
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12,
  }).formatToParts(now);
  const time = parts
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
  const period = parts.find((part) => part.type === "dayPeriod")?.value;
  return (
    <View style={[styles.clockFace, clockOnly && styles.centered]}>
      <View style={[styles.timeRow, clockOnly && styles.centered]}>
        <Text
          adjustsFontSizeToFit
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={{
            color: colors.foreground,
            fontSize: clockOnly
              ? dreamClockFontSize(size.width, size.height)
              : (focused ? 32 : 46) * scale,
            fontWeight: "200",
            fontVariant: ["tabular-nums"],
            includeFontPadding: false,
            flexShrink: 1,
            letterSpacing: clockOnly ? -3 : -1,
          }}
        >
          {time}
        </Text>
        {period ? (
          <Text style={{ color: colors.secondary, fontSize: Math.max(11, 13 * scale) }}>
            {period}
          </Text>
        ) : null}
      </View>
      {preferences.showDate ? (
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.4}
          style={{
            color: colors.secondary,
            fontSize: Math.max(12, (focused ? 12 : 14) * scale),
            textAlign: clockOnly ? "center" : "left",
          }}
        >
          {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </Text>
      ) : null}
    </View>
  );
}

export function DreamScene({
  preferences,
  now,
  colors,
  counts,
  connection,
  unavailable,
  partial,
  metric,
}: {
  readonly preferences: DreamPreferences;
  readonly now: Date;
  readonly colors: DreamColors;
  readonly counts: DreamCounts;
  readonly connection: {
    readonly text: string;
    readonly title: string;
    readonly detail: string;
    readonly color: string;
  };
  readonly unavailable: boolean;
  readonly partial: boolean;
  readonly metric: (kpi: DreamKpi) => DreamMetric;
}) {
  const dimensions = useWindowDimensions();
  const [bounds, setBounds] = useState<{ width: number; height: number }>();
  const [body, setBody] = useState<{ key: string; width: number; height: number }>();
  const size = bounds ?? dimensions;
  const { fontScale } = dimensions;
  const wide = size.width >= 600 && size.width > size.height;
  const scale = Math.max(0.65, Math.min(2, Math.min(size.width / 400, size.height / 680)));
  const gap = Math.max(10, Math.round(16 * scale));
  const clockOnly = preferences.layout === "clock";
  const focused = preferences.layout === "focus";
  const bodyKey = `${preferences.layout}:${size.width}:${size.height}:${fontScale}`;
  const bodySize = body?.key === bodyKey && body.width > 0 && body.height > 0 ? body : undefined;
  const rows = resolveDreamStatus(counts).filter((row) => row.value > 0);
  const minute = now.getMinutes();
  const shift = preferences.pixelShift
    ? [
        { translateX: minute % 2 === 0 ? -8 : 8 },
        { translateY: Math.floor(minute / 2) % 2 === 0 ? -8 : 8 },
      ]
    : [];
  const card = (kpi: DreamKpi, index: number) => {
    if (!bodySize) return null;
    const { width, height } = bodySize;
    const hero = (wide ? width - gap : height - gap) * (wide ? 0.43 : 0.32);
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
        partial={partial}
        value={metric(kpi)}
      />
    );
  };
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
          padding: Math.max(18, Math.round(28 * scale)) + (preferences.pixelShift ? 8 : 0),
        },
      ]}
    >
      {bounds ? (
        <View collapsable={false} style={[styles.content, { gap: gap * 1.5 }]}>
          <View style={[styles.header, clockOnly && styles.clockHeader, { transform: shift }]}>
            <ClockFace
              preferences={preferences}
              now={now}
              size={size}
              colors={colors}
              scale={scale}
            />
            {preferences.showStatus ? (
              <View style={styles.connection}>
                <View style={[styles.dot, { backgroundColor: connection.color }]} />
                <Text
                  numberOfLines={2}
                  maxFontSizeMultiplier={1.4}
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
              <View style={[styles.emptyRule, { backgroundColor: colors.accent }]} />
              <Text
                numberOfLines={3}
                style={{
                  color: colors.foreground,
                  fontSize: Math.max(22, 34 * scale),
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
                  lineHeight: Math.max(20, 23 * scale),
                  textAlign: "center",
                  maxWidth: 400,
                }}
              >
                {connection.detail}
              </Text>
            </View>
          ) : clockOnly ? (
            <View
              accessible
              accessibilityLabel={
                unavailable ? connection.title : dreamStatusSummary(counts, partial)
              }
              style={[
                styles.clockSummary,
                {
                  gap: 18 * scale,
                  borderTopColor: themeColorWithAlpha(colors.foreground, 0.09),
                  transform: shift,
                },
              ]}
            >
              {unavailable || rows.length === 0 ? (
                <Text style={{ color: colors.secondary, fontSize: Math.max(13, 16 * scale) }}>
                  {unavailable
                    ? connection.title
                    : partial
                      ? "Partial status. No alerts reported"
                      : "All quiet"}
                </Text>
              ) : (
                rows.map((row) => (
                  <Text
                    key={row.keys.join(":")}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.4}
                    style={{
                      color: row.keys.some((key) => key === "failed" || key === "limited")
                        ? colors.alert
                        : colors.secondary,
                      fontSize: Math.max(13, 16 * scale),
                    }}
                  >{`${partial ? "~" : ""}${row.value}\u00a0${row.label.toLowerCase().replaceAll(" ", "\u00a0")}`}</Text>
                ))
              )}
            </View>
          ) : (
            <View
              key={bodyKey}
              collapsable={false}
              onLayout={({ nativeEvent: { layout } }) =>
                setBody((current) =>
                  current?.key === bodyKey &&
                  current.width === layout.width &&
                  current.height === layout.height
                    ? current
                    : { key: bodyKey, width: layout.width, height: layout.height },
                )
              }
              style={[styles.body, { transform: shift, opacity: bodySize ? 1 : 0 }]}
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

const SAMPLE_COUNTS = {
  working: 3,
  input: 1,
  questions: 0,
  finished: 2,
  failed: 0,
  waiting: 0,
  limited: 0,
};

export function DreamSampleScene({ preferences }: { readonly preferences: DreamPreferences }) {
  const { now } = useDreamClock();
  const { themeVariablesByAppearance } = useAppearancePreferences();
  const colors = resolveDreamPalette(preferences.palette, themeVariablesByAppearance.dark);
  const metric = (kpi: DreamKpi): DreamMetric => {
    switch (kpi) {
      case "tokens":
        return { value: "128K", detail: "Selected machines", alert: false };
      case "cost":
        return { value: "$0.42", detail: "Estimated", alert: false };
      case "limits":
        return { value: "68%", detail: "Codex Session", alert: false, progress: 68 };
      case "connections":
        return { value: "2/2", detail: "Connected", alert: false };
      case "working":
      case "input":
      case "questions":
      case "finished":
      case "failed":
        return { value: String(SAMPLE_COUNTS[kpi]), detail: "Sample sessions", alert: false };
      default:
        return { value: "", detail: "", alert: false };
    }
  };
  return (
    <DreamScene
      preferences={preferences}
      now={now}
      colors={colors}
      counts={SAMPLE_COUNTS}
      connection={{ text: "Sample", title: "", detail: "", color: colors.secondary }}
      unavailable={false}
      partial={false}
      metric={metric}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", alignItems: "center" },
  content: { flex: 1, width: "100%", maxWidth: 1280 },
  body: { flex: 1, minHeight: 0 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16 },
  clockHeader: { flex: 1, flexDirection: "column", justifyContent: "center", gap: 24 },
  clockFace: { gap: 6, minWidth: 0, flexShrink: 1 },
  centered: { alignItems: "center", justifyContent: "center" },
  timeRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  connection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
    maxWidth: "45%",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18 },
  emptyRule: { width: 36, height: 3, marginBottom: 10, borderRadius: 2 },
  clockSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    borderTopWidth: 1,
    paddingTop: 22,
    paddingBottom: 8,
  },
});
