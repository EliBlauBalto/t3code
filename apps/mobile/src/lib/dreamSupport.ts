import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

export const dreamControls = requireOptionalNativeModule<{
  isDreamSupported?(): boolean;
  openDreamSettings(): void;
}>("T3NativeControls");

export function supportsDream() {
  return Platform.OS === "android" && dreamControls?.isDreamSupported?.() === true;
}
