import { expect, it, vi } from "vite-plus/test";

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: { extra: { appVariant: "dream", relay: { url: "https://relay.t3.codes" } } },
  },
}));
vi.mock("expo-observe", () => {
  throw new Error("Project ID is required to send observability metrics");
});

it("starts a standalone build without initializing hosted crash reporting", async () => {
  const reporting = await import("./observe");
  expect(reporting.crashReportingAvailable).toBe(false);
  await expect(reporting.setCrashReportsEnabled(true)).resolves.toBeUndefined();
});
