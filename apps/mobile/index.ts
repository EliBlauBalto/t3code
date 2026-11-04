// Must stay first: the render counter and behavior probe wrap the DevTools hook before any React commit.
import "./src/features/development/render-counter-entry";
import "./src/features/development/behavior-probe-entry";
import { registerRootComponent } from "expo";
import { AppRegistry, LogBox, Platform } from "react-native";
import { createElement } from "react";
import { AppStartup } from "./src/AppStartup";

async function prepareRuntime() {
  // Observe must install its error handler before either app's modules evaluate.
  await import("./src/features/observability/observe");
  await import("react-native-gesture-handler");
  const { featureFlags } = await import("react-native-screens");
  featureFlags.experiment.synchronousScreenUpdatesEnabled = true;
}

async function loadApp() {
  await prepareRuntime();
  return import("./src/App");
}

async function loadDream() {
  await prepareRuntime();
  return import("./src/features/dream/DreamDashboard");
}

if (process.env.EXPO_PUBLIC_SHOWCASE === "1") {
  LogBox.ignoreAllLogs();
}

registerRootComponent(() => createElement(AppStartup, { load: loadApp }));
if (Platform.OS === "android") {
  AppRegistry.registerComponent(
    "T3Dream",
    () => () => createElement(AppStartup, { load: loadDream }),
  );
  // DreamService owns this native timer lease; it must not resume the normal app or mark threads viewed.
  AppRegistry.registerHeadlessTask("T3DreamLifetime", () => () => new Promise<void>(() => {}));
}
