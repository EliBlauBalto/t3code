import { useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import { Modal, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";

import { ListActionRow } from "../../components/ui/ListActionRow";
import { DreamDisplay } from "./DreamDashboard";
import type { useDreamSources } from "./useDreamDashboard";
import { useAppForeground } from "../../lib/appState";

export function DreamPreview({ source }: { readonly source: ReturnType<typeof useDreamSources> }) {
  const [width, setWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const focused = useIsFocused();
  const foreground = useAppForeground();
  return (
    <>
      <View className="p-3">
        <View
          onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={{
            aspectRatio: 16 / 10,
            overflow: "hidden",
            borderRadius: 20,
            backgroundColor: "#080808",
          }}
        >
          {width > 0 && focused && foreground && !expanded ? (
            <View
              style={{
                width: 640,
                height: 400,
                transformOrigin: "top left",
                transform: [{ scale: width / 640 }],
              }}
            >
              <DreamDisplay source={source} />
            </View>
          ) : null}
        </View>
      </View>
      <ListActionRow
        label="Full-screen preview"
        disabled={!source.ready}
        onPress={() => setExpanded(true)}
      />
      <Modal
        visible={expanded && focused && foreground}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        supportedOrientations={["portrait", "landscape"]}
        onRequestClose={() => setExpanded(false)}
      >
        <View style={{ flex: 1 }}>
          {expanded && focused && foreground ? <StatusBar hidden /> : null}
          <DreamDisplay source={source} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close preview"
            onPress={() => setExpanded(false)}
            style={[
              StyleSheet.absoluteFill,
              { justifyContent: "flex-end", alignItems: "center", paddingBottom: 28 },
            ]}
          >
            <Text style={{ color: "#aaa", fontSize: 12 }}>Tap anywhere to close</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}
