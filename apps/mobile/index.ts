// Must stay first: the render counter and behavior probe wrap the DevTools hook before any React commit.
import "./src/features/development/render-counter-entry";
import "./src/features/development/behavior-probe-entry";
// Next, so errors thrown while the rest of the app loads are recorded too.
import "./src/features/observability/observe";
import { registerRootComponent } from "expo";
import "react-native-gesture-handler";
import { AppRegistry, LogBox, Platform } from "react-native";
import { featureFlags } from "react-native-screens";

import App from "./src/App";
import DreamDashboardRoot from "./src/features/dream/DreamDashboard";

// Enables iOS FormSheet sizing for nested native stacks in non-fitToContents sheets.
featureFlags.experiment.synchronousScreenUpdatesEnabled = true;

if (process.env.EXPO_PUBLIC_SHOWCASE === "1") {
  LogBox.ignoreAllLogs();
}

registerRootComponent(App);
if (Platform.OS === "android") {
  AppRegistry.registerComponent("T3Dream", () => DreamDashboardRoot);
  // DreamService owns this native timer lease; it must not resume the normal app or mark threads viewed.
  AppRegistry.registerHeadlessTask("T3DreamLifetime", () => () => new Promise<void>(() => {}));
}
