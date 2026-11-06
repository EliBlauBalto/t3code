import { StyleSheet, Text, View } from "react-native";
import {
  DREAM_KPIS,
  dreamStatusSummary,
  resolveDreamStatus,
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
  if (kpi === "") return <View style={[styles.card, frame]} />;
  const rows = resolveDreamStatus(counts).filter((row) => row.value > 0);
  const lead =
    rows.find((row) => row.keys.some((key) => key === "failed" || key === "limited")) ??
    rows.find((row) => row.keys.some((key) => key === "input" || key === "questions")) ??
    rows.find((row) => row.keys[0] === "working") ??
    rows[0];
  const supporting = rows.filter((row) => row !== lead);
  const leadAlert = lead?.keys.some((key) => key === "failed" || key === "limited");
  const leadAttention = lead?.keys.some((key) => key === "input" || key === "questions");
  const highlight =
    kpi === "status"
      ? leadAlert
        ? colors.alert
        : leadAttention
          ? colors.accent
          : colors.foreground
      : value.alert
        ? colors.alert
        : colors.foreground;
  const padding = focused ? 12 : Math.max(12, Math.min(28, frame.width * 0.07));
  const numericScale = Math.min(fontScale, 1.4);
  const numberSize =
    (focused
      ? Math.min(280, frame.width * 0.42, frame.height * 0.37)
      : large
        ? Math.min(112, frame.height * 0.38, frame.width * 0.24)
        : Math.min(96, frame.width * 0.29, frame.height * 0.34)) / numericScale;
  const labelSize = Math.max(11, Math.min(focused ? 18 : 14, 12 * scale));
  const detailSize = Math.max(11, Math.min(focused ? 20 : 14, 12 * scale));
  const title = DREAM_KPIS[kpi];
  const summary =
    kpi === "status"
      ? dreamStatusSummary(counts, partial)
      : `${title}. ${value.value}. ${value.detail}`;
  return (
    <View
      accessible
      accessibilityLabel={summary}
      style={[
        styles.card,
        frame,
        {
          backgroundColor: focused ? "transparent" : colors.card,
          borderWidth: focused ? 0 : 1,
          borderColor: themeColorWithAlpha(colors.foreground, 0.07),
          borderRadius: large ? 24 : 20,
          padding,
          justifyContent: focused ? "center" : "flex-start",
          gap: focused ? 18 : 8,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.4}
        style={[
          styles.label,
          { color: colors.secondary, fontSize: labelSize, textAlign: focused ? "center" : "left" },
        ]}
      >
        {title}
      </Text>
      <View
        style={[
          styles.reading,
          { gap: focused ? 20 : 8 },
          focused && [styles.centered, { flex: 0, width: "100%" }],
        ]}
      >
        {kpi === "status" ? (
          <>
            {lead ? (
              <View style={[styles.statusLead, focused && styles.focusLead]}>
                <Text
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.4}
                  style={[
                    styles.number,
                    {
                      color: highlight,
                      fontSize: numberSize,
                      textAlign: focused ? "center" : "left",
                    },
                  ]}
                >
                  {`${partial ? "~" : ""}${lead.value}`}
                </Text>
                <Text
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.4}
                  style={{
                    color: highlight,
                    fontWeight: "400",
                    fontSize: Math.max(
                      15,
                      Math.min(focused ? 52 : large ? 32 : 22, numberSize * 0.42),
                    ),
                    flexShrink: 1,
                  }}
                >
                  {lead.label}
                </Text>
              </View>
            ) : (
              <View style={{ gap: 10, alignItems: focused ? "center" : "flex-start" }}>
                <View
                  style={{
                    width: 30,
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: colors.accent,
                    marginBottom: 8,
                  }}
                />
                <Text
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  maxFontSizeMultiplier={1.4}
                  style={{
                    color: colors.foreground,
                    fontWeight: "300",
                    fontSize: Math.max(22, numberSize * 0.6),
                    textAlign: focused ? "center" : "left",
                  }}
                >
                  {partial ? "No alerts reported" : "All quiet"}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.4}
                  style={{ color: colors.secondary, fontSize: Math.max(11, 13 * scale) }}
                >
                  {partial ? "Partial session status" : "Nothing needs your attention"}
                </Text>
              </View>
            )}
            {supporting.length > 0 ? (
              <View
                style={[styles.supporting, focused && styles.centered, { gap: focused ? 18 : 12 }]}
              >
                {supporting.map((row) => (
                  <Text
                    key={row.keys.join(":")}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.4}
                    style={{
                      color: row.keys.some((key) => key === "failed" || key === "limited")
                        ? colors.alert
                        : colors.secondary,
                      fontSize: Math.max(11, Math.min(focused ? 22 : 15, 13 * scale)),
                    }}
                  >
                    {`${partial ? "~" : ""}${row.value}\u00a0${row.label.toLowerCase().replaceAll(" ", "\u00a0")}`}
                  </Text>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              maxFontSizeMultiplier={1.4}
              style={[
                styles.number,
                { color: highlight, fontSize: numberSize, textAlign: focused ? "center" : "left" },
              ]}
            >
              {value.value}
            </Text>
            {kpi === "limits" && typeof value.progress === "number" ? (
              <View
                style={[
                  styles.track,
                  {
                    backgroundColor: themeColorWithAlpha(colors.foreground, 0.1),
                    maxWidth: focused ? 320 : undefined,
                  },
                ]}
              >
                <View
                  style={{
                    height: 4,
                    width: `${value.progress}%`,
                    backgroundColor: highlight === colors.alert ? colors.alert : colors.accent,
                    borderRadius: 2,
                  }}
                />
              </View>
            ) : (
              <View style={{ height: 4, marginVertical: 2 }} />
            )}
            <Text
              numberOfLines={2}
              maxFontSizeMultiplier={1.4}
              style={{
                color: colors.secondary,
                fontSize: detailSize,
                lineHeight: detailSize * 1.4,
                height: focused ? undefined : Math.ceil(detailSize * 1.4 * numericScale * 2),
                textAlign: focused ? "center" : "left",
              }}
            >
              {value.detail}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: "absolute", minWidth: 0, overflow: "hidden" },
  label: { letterSpacing: 1.1, textTransform: "uppercase", fontWeight: "500", flexShrink: 1 },
  reading: { flex: 1, justifyContent: "center", minHeight: 0 },
  centered: { alignItems: "center", justifyContent: "center" },
  number: {
    fontWeight: "300",
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
    flexShrink: 1,
  },
  statusLead: { flexDirection: "row", alignItems: "baseline", gap: 12, minWidth: 0 },
  focusLead: { flexDirection: "column", alignItems: "center", gap: 8 },
  supporting: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  track: { height: 4, borderRadius: 2, overflow: "hidden", width: "100%", marginVertical: 2 },
});
