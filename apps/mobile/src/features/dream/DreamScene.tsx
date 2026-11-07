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
import { FONT_FAMILIES } from "../../lib/fontFamilies";
import { dreamControls } from "../../lib/dreamSupport";
import { themeColorWithAlpha, themeColorWithContrast } from "../../lib/mobileTheme";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { DreamReading, type DreamReadingValue } from "./DreamReading";
import { useDreamClock } from "./useDreamDashboard";

const PALETTES = {
  amber: {
    screen: "#080502",
    foreground: "#e8cfaa",
    secondary: "#b7a58b",
    accent: "#d9b88a",
    alert: "#e4b18b",
  },
  mono: {
    screen: "#000000",
    foreground: "#e5e5e5",
    secondary: "#b0b0b0",
    accent: "#cccccc",
    alert: "#e5e5e5",
  },
} as const;

export function resolveDreamPalette(
  palette: DreamPalette,
  base: ReturnType<typeof useAppearancePreferences>["themeVariablesByAppearance"]["dark"],
) {
  return palette === "theme"
    ? {
        screen: base["--color-screen"],
        foreground: base["--color-foreground"],
        secondary: themeColorWithAlpha(base["--color-foreground"], 0.72),
        accent: themeColorWithContrast(base["--color-primary"], base["--color-screen"], 7),
        alert: "#dfad94",
      }
    : PALETTES[palette];
}

type DreamColors = ReturnType<typeof resolveDreamPalette>;
type DreamCounts = ReturnType<typeof summarizeDreamThreads>;

function ClockFace({
  preferences,
  now,
  colors,
  size,
  compact = false,
  central = false,
}: {
  readonly preferences: DreamPreferences;
  readonly now: Date;
  readonly colors: DreamColors;
  readonly size: number;
  readonly compact?: boolean;
  readonly central?: boolean;
}) {
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
    <View style={[styles.clock, central && { alignItems: "center" }]}>
      <View style={styles.timeRow}>
        <Text
          adjustsFontSizeToFit
          numberOfLines={1}
          maxFontSizeMultiplier={1.05}
          style={{
            color: colors.foreground,
            fontFamily: FONT_FAMILIES.medium,
            fontSize: size,
            fontVariant: ["tabular-nums"],
            includeFontPadding: false,
            flexShrink: 1,
          }}
        >
          {time}
        </Text>
        {period ? (
          <Text
            maxFontSizeMultiplier={1.3}
            style={{
              color: colors.secondary,
              fontFamily: FONT_FAMILIES.regular,
              fontSize: compact ? 16 : Math.max(18, size * 0.13),
              paddingLeft: compact ? 6 : 10,
            }}
          >
            {period}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function SessionReading({
  counts,
  partial,
  colors,
  scale,
  primary = false,
  brief = false,
  compact = false,
}: {
  readonly counts: DreamCounts;
  readonly partial: boolean;
  readonly colors: DreamColors;
  readonly scale: number;
  readonly primary?: boolean;
  readonly brief?: boolean;
  readonly compact?: boolean;
}) {
  const rows = resolveDreamStatus(counts).filter((row) => row.value > 0);
  const first =
    rows.find((row) => row.keys[0] === "failed") ??
    rows.find((row) => row.keys[0] === "input") ??
    rows.find((row) => row.keys[0] === "limited") ??
    rows.find((row) => row.keys[0] === "waiting") ??
    rows[0];
  const count = first ? `${first.value}${partial ? "+" : ""}` : "";
  const action = !first
    ? partial
      ? "No live activity."
      : "All quiet."
    : first.keys[0] === "input"
      ? first.value === 1 && !partial
        ? "needs you."
        : "need you."
      : first.keys[0] === "limited"
        ? "quota limited."
        : `${first.label.toLowerCase()}.`;
  const alert = first?.keys.some(
    (key) => key === "failed" || key === "limited" || key === "input" || key === "questions",
  );
  const headlineColor = first?.keys.some((key) => key === "failed" || key === "limited")
    ? colors.alert
    : alert
      ? colors.accent
      : colors.foreground;
  const title = first ? `${count} ${first.value === 1 && !partial ? "session" : "sessions"}` : "";
  const secondary = brief ? rows : rows.filter((row) => row !== first);
  return (
    <View
      accessible
      accessibilityLabel={dreamStatusSummary(counts, partial)}
      style={{ minWidth: 0, gap: 14 * scale }}
    >
      {!brief ? (
        <Text
          maxFontSizeMultiplier={1.25}
          style={{
            color: colors.foreground,
            fontFamily: FONT_FAMILIES.medium,
            fontSize: (primary ? 54 : 34) * scale,
            lineHeight: (primary ? 62 : 40) * scale,
          }}
        >
          {title ? `${title}${compact ? " " : "\n"}` : ""}
          <Text style={{ color: headlineColor }}>{action}</Text>
        </Text>
      ) : null}
      {secondary.length > 0 ? (
        <View style={[styles.support, { columnGap: 20 * scale, rowGap: 6 * scale }]}>
          {secondary.map((row) => (
            <Text
              key={row.keys.join(":")}
              maxFontSizeMultiplier={1.5}
              style={{
                color: row.keys.some((key) => key === "failed" || key === "limited")
                  ? colors.alert
                  : colors.secondary,
                fontFamily: FONT_FAMILIES.regular,
                fontSize: (brief ? 20 : 17) * scale,
                maxWidth: "100%",
              }}
            >
              {`${row.value}${partial ? "+" : ""}\u00a0${brief ? `${row.value === 1 && !partial ? "session" : "sessions"} ` : ""}${row.keys[0] === "input" && brief ? (row.value === 1 && !partial ? "needs you" : "need you") : row.label.toLowerCase()}`}
            </Text>
          ))}
        </View>
      ) : brief ? (
        <Text
          maxFontSizeMultiplier={1.5}
          style={{
            color: colors.secondary,
            fontFamily: FONT_FAMILIES.regular,
            fontSize: 20 * scale,
          }}
        >
          {action}
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
  readonly metric: (kpi: DreamKpi) => DreamReadingValue;
}) {
  const [bounds, setBounds] = useState<{ width: number; height: number }>();
  const { fontScale } = useWindowDimensions();
  const width = bounds?.width ?? 0,
    height = bounds?.height ?? 0;
  const wide = width >= 600 && width > height;
  const slots = preferences.slots.filter((slot) => slot !== "");
  const clockOnly =
    preferences.layout === "clock" || (preferences.layout === "focus" && !preferences.slots[0]);
  const focused = preferences.layout === "focus" && !clockOnly;
  const main = !focused && slots.includes("status") ? "status" : (preferences.slots[0] ?? "");
  const supporting = slots.filter((slot) => slot !== main);
  const dense = !focused && supporting.length === 4;
  const scale = Math.max(
    0.8,
    Math.min(2.6, width / (wide ? 760 : 360), height / (wide ? 420 : dense ? 720 : 640)),
  );
  const heroScale = Math.max(scale, Math.min(3, Math.min(width, height) / 360));
  const spacingScale = scale * (fontScale >= 1.5 ? 0.75 : 1);
  const minute = now.getMinutes();
  const shift = preferences.pixelShift
    ? [{ translateX: minute % 2 ? 6 : -6 }, { translateY: Math.floor(minute / 2) % 2 ? 6 : -6 }]
    : [];
  const reading = (kpi: DreamKpi, primary: boolean) =>
    kpi === "status" ? (
      <SessionReading
        counts={counts}
        partial={partial}
        colors={colors}
        scale={primary ? heroScale : scale}
        primary={primary && focused}
        brief={!primary}
        compact={!focused && dense}
      />
    ) : kpi === "" ? null : (
      <DreamReading
        kpi={kpi}
        reading={metric(kpi)}
        primary={primary}
        focused={focused}
        horizontal={wide && !primary}
        scale={primary && focused ? heroScale : scale}
        spacingScale={spacingScale}
        colors={colors}
      />
    );
  const date = preferences.showDate ? (
    <Text
      maxFontSizeMultiplier={1.4}
      style={{ color: colors.secondary, fontFamily: FONT_FAMILIES.regular, fontSize: 16 * scale }}
    >
      {now.toLocaleDateString(undefined, {
        weekday: focused ? "short" : "long",
        month: focused ? "short" : "long",
        day: "numeric",
      })}
    </Text>
  ) : null;
  const clock = (compact: boolean, central = false) => (
    <ClockFace
      preferences={preferences}
      now={now}
      colors={colors}
      compact={compact}
      central={central}
      size={
        compact
          ? 28 * scale
          : clockOnly
            ? dreamClockFontSize(width - 72, height - 96)
            : wide
              ? height * 0.22
              : 104 * scale
      }
    />
  );
  return (
    <View
      onLayout={({ nativeEvent: { layout } }) =>
        setBounds((current) =>
          current?.width === layout.width && current.height === layout.height
            ? current
            : { width: layout.width, height: layout.height },
        )
      }
      style={[
        styles.root,
        {
          backgroundColor: colors.screen,
          padding: (wide ? 34 : 28) * scale + (preferences.pixelShift ? 6 : 0),
        },
      ]}
    >
      {bounds ? (
        <View
          style={[
            styles.content,
            { transform: shift, gap: (wide && dense ? 16 : 22) * spacingScale },
          ]}
        >
          {unavailable ? (
            <>
              <View style={{ gap: 12 * scale }}>
                {date}
                {clock(false)}
              </View>
              <View style={[styles.center, { gap: 18 * scale }]}>
                <Text
                  style={{
                    color: colors.foreground,
                    fontFamily: FONT_FAMILIES.medium,
                    fontSize: 34 * scale,
                  }}
                >
                  {connection.title}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.5}
                  style={{
                    color: colors.secondary,
                    fontFamily: FONT_FAMILIES.regular,
                    fontSize: 18 * scale,
                    maxWidth: 520,
                  }}
                >
                  {connection.detail}
                </Text>
              </View>
            </>
          ) : clockOnly ? (
            <>
              {date}
              <View style={styles.center}>{clock(false, true)}</View>
              <SessionReading
                counts={counts}
                partial={partial}
                colors={colors}
                scale={scale}
                brief
              />
            </>
          ) : focused ? (
            <>
              <View style={styles.focusHeader}>
                {clock(true)}
                {date}
              </View>
              <View style={styles.center}>{reading(main, true)}</View>
            </>
          ) : (
            <>
              <View
                style={[
                  styles.overview,
                  wide && styles.overviewWide,
                  { gap: (dense ? 20 : 28) * spacingScale },
                ]}
              >
                <View
                  style={[styles.overviewClock, wide && { flex: 1 }, { gap: 12 * spacingScale }]}
                >
                  {date}
                  {clock(false)}
                </View>
                {main !== "" ? (
                  <View style={wide ? styles.primaryWide : undefined}>{reading(main, true)}</View>
                ) : null}
              </View>
              {supporting.length > 0 ? (
                <View style={[styles.ledger, wide && { flexDirection: "row", gap: 28 * scale }]}>
                  {supporting.map((kpi) => (
                    <View key={kpi} style={wide ? { flex: 1, minWidth: 0 } : undefined}>
                      {reading(kpi, false)}
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          )}
          {preferences.showStatus ? (
            <View style={styles.connection}>
              <View
                style={[
                  styles.dot,
                  {
                    width: 6 * scale,
                    height: 6 * scale,
                    backgroundColor:
                      preferences.palette === "theme" ? connection.color : colors.secondary,
                  },
                ]}
              />
              <Text
                maxFontSizeMultiplier={1.4}
                style={{
                  color: colors.secondary,
                  fontFamily: FONT_FAMILIES.regular,
                  fontSize: 14 * scale,
                  flexShrink: 1,
                }}
              >
                {connection.text}
              </Text>
            </View>
          ) : null}
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
  const metric = (kpi: DreamKpi): DreamReadingValue => {
    switch (kpi) {
      case "tokens":
        return { value: "300K", detail: "Selected machines", alert: false };
      case "cost":
        return { value: "$0.96", detail: "Estimated", alert: false };
      case "limits":
        return { value: "36%", detail: "Codex Session", alert: false, progress: 36 };
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
  root: { flex: 1, alignItems: "center" },
  content: { flex: 1, width: "100%", maxWidth: 1280 },
  overview: { flex: 1, minHeight: 0, justifyContent: "space-evenly", paddingBottom: 4 },
  overviewWide: { flexDirection: "row", alignItems: "center" },
  overviewClock: { minWidth: 0, flexShrink: 1 },
  primaryWide: { flex: 1, minWidth: 0 },
  focusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 18,
  },
  clock: { minWidth: 0 },
  timeRow: { flexDirection: "row", alignItems: "baseline", minWidth: 0 },
  center: { flex: 1, minHeight: 0, justifyContent: "center" },
  support: { flexDirection: "row", flexWrap: "wrap" },
  ledger: { gap: 0 },
  connection: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  dot: { borderRadius: 20 },
});
