import { StyleSheet, Text, View } from "react-native";
import { DREAM_KPIS, type DreamKpi } from "../../lib/dreamDashboard";
import { FONT_FAMILIES } from "../../lib/fontFamilies";
import { themeColorWithAlpha } from "../../lib/mobileTheme";

export type DreamReadingValue = {
  readonly value: string;
  readonly detail: string;
  readonly alert: boolean;
  readonly progress?: number | null;
};

export function DreamReading({
  kpi,
  reading,
  primary = false,
  focused = false,
  horizontal = false,
  scale,
  colors,
}: {
  readonly kpi: DreamKpi;
  readonly reading: DreamReadingValue;
  readonly primary?: boolean;
  readonly focused?: boolean;
  readonly horizontal?: boolean;
  readonly scale: number;
  readonly colors: {
    readonly foreground: string;
    readonly secondary: string;
    readonly alert: string;
  };
}) {
  const estimatedCost = kpi === "cost" && reading.detail === "Estimated";
  const label = estimatedCost ? "Est. 24h cost" : DREAM_KPIS[kpi];
  const detail = estimatedCost || reading.detail === "Selected machines" ? "" : reading.detail;
  const value = (
    <Text
      adjustsFontSizeToFit
      minimumFontScale={0.65}
      numberOfLines={1}
      maxFontSizeMultiplier={1.15}
      style={[
        styles.value,
        {
          color: reading.alert ? colors.alert : colors.foreground,
          fontSize: (primary ? (focused ? 104 : 68) : horizontal ? 42 : 36) * scale,
        },
        !primary && !horizontal && { maxWidth: "52%" },
      ]}
    >
      {reading.value}
    </Text>
  );
  return (
    <View
      accessible
      accessibilityLabel={`${label}. ${reading.value}. ${reading.detail}`}
      style={[
        styles.reading,
        primary ? styles.primary : horizontal ? styles.column : styles.row,
        !primary && {
          borderTopColor: themeColorWithAlpha(colors.secondary, 0.2),
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingVertical: 12 * scale,
        },
      ]}
    >
      {horizontal && !primary ? value : null}
      <View style={[styles.caption, !primary && !horizontal && { flex: 1 }]}>
        <Text
          maxFontSizeMultiplier={1.5}
          style={{
            color: colors.secondary,
            fontFamily: FONT_FAMILIES.regular,
            fontSize: (primary ? (focused ? 24 : 20) : 17) * scale,
          }}
        >
          {label}
        </Text>
        {detail ? (
          <Text
            maxFontSizeMultiplier={1.4}
            style={{
              color: colors.secondary,
              fontFamily: FONT_FAMILIES.regular,
              fontSize: (primary ? (focused ? 19 : 16) : 15) * scale,
            }}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {!horizontal || primary ? value : null}
    </View>
  );
}

const styles = StyleSheet.create({
  reading: { minWidth: 0, gap: 8 },
  primary: { justifyContent: "center", gap: 16 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 18 },
  column: { justifyContent: "flex-start" },
  caption: { minWidth: 0, gap: 3 },
  value: {
    fontFamily: FONT_FAMILIES.medium,
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
    flexShrink: 1,
  },
});
