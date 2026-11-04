import { expect, it, vi } from "vite-plus/test";

const device = vi.hoisted(() => ({
  platform: "android",
  controls: null as { isDreamSupported?: () => boolean; openDreamSettings: () => void } | null,
}));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => device.controls }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return device.platform;
    },
  },
}));

it("exposes the screen saver only when Android can open its system settings", async () => {
  device.platform = "android";
  device.controls = null;
  vi.resetModules();
  expect((await import("./dreamSupport")).supportsDream()).toBe(false);
  device.controls = { openDreamSettings: () => {} };
  vi.resetModules();
  expect((await import("./dreamSupport")).supportsDream()).toBe(false);
  device.controls = { ...device.controls, isDreamSupported: () => false };
  vi.resetModules();
  expect((await import("./dreamSupport")).supportsDream()).toBe(false);
  device.controls = { ...device.controls, isDreamSupported: () => true };
  vi.resetModules();
  expect((await import("./dreamSupport")).supportsDream()).toBe(true);
  device.platform = "ios";
  expect((await import("./dreamSupport")).supportsDream()).toBe(false);
});
