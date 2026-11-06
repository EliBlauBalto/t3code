import { useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import { Modal, Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListActionRow } from "../../components/ui/ListActionRow";
import { AppText as Text } from "../../components/ui/AppText";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { DreamDisplay } from "./DreamDashboard";
import { DreamSampleScene } from "./DreamScene";
import type { useDreamSources } from "./useDreamDashboard";
import { useAppForeground } from "../../lib/appState";

export function DreamPreview({ source }: { readonly source: ReturnType<typeof useDreamSources> }) {
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
  const sample = source.presentations.size === 0;
  const previewScale = Math.min(stage.width / canvas.width, stage.height / canvas.height);
  return (
    <>
      <ListActionRow
        label="Full-screen preview"
        description={
          sample
            ? "Sample data until you connect a machine."
            : "See this style with your selected sessions."
        }
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
        <View className="flex-1 bg-screen" style={{ paddingTop: insets.top }}>
          <Pressable
            accessible={false}
            onPress={() => setExpanded(false)}
            onLayout={({ nativeEvent }) => setStage(nativeEvent.layout)}
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
            className="bg-black"
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
                  {sample ? (
                    <DreamSampleScene preferences={source.preferences} />
                  ) : (
                    <DreamDisplay source={source} />
                  )}
                </View>
              </View>
            ) : null}
          </Pressable>
          <View
            className="border-t border-border-subtle bg-screen"
            style={{
              gap: 12,
              paddingHorizontal: 18,
              paddingTop: 14,
              paddingBottom: Math.max(18, insets.bottom),
            }}
          >
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1, justifyContent: "center" }}>
                <SegmentedControl
                  variant="card"
                  role="tab"
                  options={[
                    {
                      value: "portrait",
                      label: "Portrait",
                      accessibilityLabel: "Portrait preview",
                    },
                    {
                      value: "landscape",
                      label: "Landscape",
                      accessibilityLabel: "Landscape preview",
                    },
                  ]}
                  selected={orientation}
                  onSelect={setOrientation}
                />
              </View>
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
                <Text textRole="footnote" className="font-t3-medium text-primary">
                  Done
                </Text>
              </Pressable>
            </View>
            <Text textRole="caption" className="text-center text-foreground-muted">
              {sample
                ? "Sample preview. Connect a machine for live status."
                : "Live preview. Tap the canvas to close."}
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
}
