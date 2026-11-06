import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

export const dreamControls = requireOptionalNativeModule<{
  isDreamSupported?(): boolean;
  is24HourFormat?(): boolean;
  openDreamSettings(): boolean;
}>("T3NativeControls");

let dreamSupported: boolean | undefined;

export function supportsDream() {
  if (Platform.OS !== "android") return false;
  return (dreamSupported ??= dreamControls?.isDreamSupported?.() === true);
}
