import { StyleSheet, Text, View } from "react-native";
import {
  DREAM_KPIS,
  dreamStatusSummary,
  dreamTileScale,
  resolveDreamStatusRows,
  type DreamKpi,
  type summarizeDreamThreads,
} from "../../lib/dreamDashboard";
import { themeColorWithAlpha } from "../../lib/mobileTheme";

type DreamColors = Readonly<
  Record<"screen" | "card" | "foreground" | "secondary" | "accent" | "alert", string>
>;

export function DreamTile({
  kpi,
  large,
  focused,
  frame,
  scale,
  fontScale,
  colors,
  counts,
  partial,
  value,
}: {
  readonly kpi: DreamKpi;
  readonly large: boolean;
  readonly focused: boolean;
  readonly frame: Readonly<{ left: number; top: number; width: number; height: number }>;
  readonly scale: number;
  readonly fontScale: number;
  readonly colors: DreamColors;
  readonly counts: ReturnType<typeof summarizeDreamThreads>;
  readonly partial: boolean;
  readonly value: {
    readonly value: string;
    readonly detail: string;
    readonly alert: boolean;
    readonly progress?: number | null;
  };
}) {
  const number = (value: number) => `${partial ? "~" : ""}${value}`;
  const needsYou = (kpi: "input" | "questions") => counts[kpi] > 0;
  if (kpi === "") return <View style={[styles.card, frame]} />;
  const tileScale = dreamTileScale(scale, frame, large && kpi === "status", fontScale);
  const compactStatus = kpi === "status" && (!large || frame.height < 180);
  const statusRows = kpi === "status" ? resolveDreamStatusRows(counts) : [];
  const danger = value.alert || (kpi === "status" && (counts.failed > 0 || counts.limited > 0));
  const attention =
    kpi === "status"
      ? needsYou("input") || needsYou("questions") || counts.failed > 0 || counts.limited > 0
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
      accessible={kpi === "status"}
      accessibilityLabel={kpi === "status" ? dreamStatusSummary(counts, partial) : undefined}
      style={[
        styles.card,
        frame,
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
      {large || !compactStatus ? (
        <View style={[styles.cardLabel, focused && styles.focusLabel]}>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.4}
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
            focused && compactStatus && styles.focusCompactStatusGrid,
          ]}
        >
          {statusRows.map((row) => (
            <View
              key={row.keys.join(":")}
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
                    color: row.keys.some(
                      (key) => (key === "failed" || key === "limited") && counts[key] > 0,
                    )
                      ? colors.alert
                      : row.keys.some(
                            (key) => (key === "input" || key === "questions") && needsYou(key),
                          )
                        ? colors.accent
                        : row.values.every((value) => value === 0)
                          ? colors.secondary
                          : colors.foreground,
                    fontSize: compactStatus
                      ? Math.max(11, 20 * tileScale)
                      : (large ? 60 : 30) * tileScale,
                    fontWeight: compactStatus ? "500" : "300",
                  },
                ]}
              >
                {row.values.map(number).join(" / ")}
              </Text>
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.4}
                style={[
                  {
                    color: colors.secondary,
                    fontSize: Math.max(11, (large ? 14 : 11) * tileScale),
                  },
                  compactStatus && styles.compactStatusText,
                ]}
              >
                {row.label}
              </Text>
            </View>
          ))}
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
            numberOfLines={2}
            maxFontSizeMultiplier={1.4}
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

const styles = StyleSheet.create({
  focusValue: { justifyContent: "center" },
  focusLabel: { justifyContent: "center" },
  focusStatusGrid: { flex: 0, width: "100%", maxWidth: 480, alignSelf: "center" },
  focusCompactStatusGrid: { width: "100%", maxWidth: 260 },
  focusStatusCell: { alignItems: "center" },
  card: {
    position: "absolute",
    minWidth: 0,
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
  dot: { width: 8, height: 8, borderRadius: 4 },
});
