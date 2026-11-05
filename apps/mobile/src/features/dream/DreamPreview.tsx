import { useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import { Modal, Pressable, StatusBar, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListActionRow } from "../../components/ui/ListActionRow";
import { DreamDisplay } from "./DreamDashboard";
import type { useDreamSources } from "./useDreamDashboard";
import { useAppForeground } from "../../lib/appState";

export function DreamPreview({ source }: { readonly source: ReturnType<typeof useDreamSources> }) {
  const [width, setWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const short = Math.max(1, Math.min(window.width, window.height));
  const long = Math.max(1, Math.max(window.width, window.height));
  const canvas =
    orientation === "portrait" ? { width: short, height: long } : { width: long, height: short };
  const thumbnailScale = Math.min(
    width / Math.max(1, window.width),
    240 / Math.max(1, window.height),
  );
  const previewScale = Math.min(stage.width / canvas.width, stage.height / canvas.height);
  return (
    <>
      <View className="p-3">
        <View
          onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={{
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            borderRadius: 20,
            backgroundColor: "#080808",
          }}
        >
          <View
            style={{ width: window.width * thumbnailScale, height: window.height * thumbnailScale }}
          >
            {width > 0 && focused && foreground && !expanded ? (
              <View
                style={{
                  width: window.width,
                  height: window.height,
                  transformOrigin: "top left",
                  transform: [{ scale: thumbnailScale }],
                }}
              >
                <DreamDisplay source={source} />
              </View>
            ) : null}
          </View>
        </View>
      </View>
      <ListActionRow
        label="Full-screen preview"
        disabled={!source.ready}
        onPress={() => {
          setOrientation(window.width > window.height ? "landscape" : "portrait");
          setExpanded(true);
        }}
      />
      <Modal
        visible={expanded && focused && foreground}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setExpanded(false)}
      >
        <View style={{ flex: 1, backgroundColor: "#080808" }}>
          {expanded && focused && foreground ? <StatusBar hidden /> : null}
          <Pressable
            accessible={false}
            onPress={() => setExpanded(false)}
            onLayout={({ nativeEvent }) => setStage(nativeEvent.layout)}
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            {stage.width > 0 && stage.height > 0 ? (
              <View
                pointerEvents="none"
                style={{
                  width: canvas.width * previewScale,
                  height: canvas.height * previewScale,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    ...canvas,
                    transformOrigin: "top left",
                    transform: [{ scale: previewScale }],
                  }}
                >
                  <DreamDisplay source={source} />
                </View>
              </View>
            ) : null}
          </Pressable>
          <View
            style={{
              gap: 12,
              paddingHorizontal: 18,
              paddingTop: 14,
              paddingBottom: Math.max(18, insets.bottom),
              borderTopWidth: 1,
              borderTopColor: "#262626",
            }}
          >
            <View style={{ flexDirection: "row", gap: 10 }}>
              {(["portrait", "landscape"] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityLabel={`${value === "portrait" ? "Portrait" : "Landscape"} preview`}
                  accessibilityState={{ checked: orientation === value }}
                  onPress={() => setOrientation(value)}
                  style={{
                    flex: 1,
                    minHeight: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 24,
                    backgroundColor: orientation === value ? "#e8e8e8" : "#202020",
                  }}
                >
                  <Text style={{ color: orientation === value ? "#111" : "#ddd", fontSize: 14 }}>
                    {value === "portrait" ? "Portrait" : "Landscape"}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close preview"
                onPress={() => setExpanded(false)}
                style={{
                  minHeight: 48,
                  paddingHorizontal: 16,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#ddd", fontSize: 14 }}>Done</Text>
              </Pressable>
            </View>
            <Text style={{ color: "#aaa", fontSize: 12, textAlign: "center" }}>
              Tap the preview to close
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
}
