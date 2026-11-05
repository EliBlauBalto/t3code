import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  UsageLimitSourceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  buildSubscriptionUsageSnapshot,
  createWidgetRefresher,
  WIDGET_REFRESH_INTERVAL,
} from "./subscriptionUsageSnapshot";

const checkedAt = "2026-09-05T12:00:00.000Z";
const now = Date.parse(checkedAt);
const window = {
  id: "session",
  kind: "session",
  label: "5 hours",
  usedPercent: 40,
  resetsAt: "2026-09-05T12:10:00.000Z",
} as const;
const limits = { checkedAt, windows: [window] };
const deepLink = "t3code-dev://settings/usage?tab=limits";
function provider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated", email: "private@example.com" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: limits,
    ...overrides,
  };
}
function presentations(providers: readonly ServerProvider[] = [provider()]) {
  return new Map([
    [
      EnvironmentId.make("env"),
      { entry: { target: { label: "Remote" } }, serverConfig: { providers } },
    ],
  ]);
}

describe("subscription widget snapshots", () => {
  it("uses provider data and its observation time without exposing account emails", () => {
    const snapshot = buildSubscriptionUsageSnapshot(
      presentations([provider({ displayName: "private@example.com" })]),
      deepLink,
    );
    expect(snapshot.checkedAt).toBe(now);
    expect(snapshot.providers[0]).toMatchObject({
      name: "Codex",
      windows: [{ remaining: 60 }],
      expiresAt: now + 10 * 60_000,
    });
    expect(snapshot.url).toBe(deepLink);
    expect(JSON.stringify(snapshot)).not.toContain("private@example.com");
  });
  it("uses upstream deduplication for a native account also present in a proxy hub", () => {
    const input = new Map([
      [
        EnvironmentId.make("env"),
        {
          entry: { target: { label: "Remote" } },
          serverConfig: {
            providers: [provider()],
            usageLimitSources: [
              {
                id: UsageLimitSourceId.make("hub"),
                kind: "cliproxy" as const,
                label: "Hub",
                checkedAt,
                accounts: [
                  {
                    id: "account",
                    driver: ProviderDriverKind.make("codex"),
                    email: " PRIVATE@example.com ",
                    usageLimits: limits,
                  },
                ],
              },
            ],
          },
        },
      ],
    ]);
    expect(buildSubscriptionUsageSnapshot(input, deepLink).providers[0]?.detail).toBe(
      "Subscription remaining",
    );
    input.get(EnvironmentId.make("env"))!.serverConfig.providers = [];
    const snapshot = buildSubscriptionUsageSnapshot(input, deepLink);
    expect(snapshot.providers[0]?.name).toBe("Codex");
    expect(JSON.stringify(snapshot)).not.toContain("example.com");
    const config = input.get(EnvironmentId.make("env"))!.serverConfig;
    config.providers = [provider()];
    const widgetBeforeSourceFailure = buildSubscriptionUsageSnapshot(input, deepLink);
    const failedSource = {
      ...config.usageLimitSources[0]!,
      error: "Fixture source could not enumerate accounts",
      accounts: [],
    };
    config.usageLimitSources = [failedSource];
    expect.soft(buildSubscriptionUsageSnapshot(input, deepLink)).toEqual(widgetBeforeSourceFailure);
    expect(
      buildSubscriptionUsageSnapshot(input, deepLink, Infinity, new Set(input.keys())).providers[0],
    ).toMatchObject({
      windows: [{ remaining: 60 }],
      partial: true,
    });
  });
  it("bounds OS storage and puts the most constrained windows first", () => {
    const windows = Array.from({ length: 20 }, (_, index) => ({
      ...window,
      id: `${index}`,
      usedPercent: index * 5,
    }));
    const snapshot = buildSubscriptionUsageSnapshot(
      presentations([provider({ usageLimits: { checkedAt, windows } })]),
      deepLink,
    );
    expect(snapshot.providers[0]?.windows).toHaveLength(6);
    expect(snapshot.providers[0]?.totalWindows).toBe(20);
    expect(snapshot.providers[0]?.windows[0]?.remaining).toBe(5);
  });
  it("uses the freshest copy of an account across environments before pooling", () => {
    const input = presentations();
    input.set(EnvironmentId.make("other"), {
      entry: { target: { label: "Other" } },
      serverConfig: {
        providers: [
          provider({
            usageLimits: {
              checkedAt: new Date(now + 60_000).toISOString(),
              windows: [{ ...window, usedPercent: 80 }],
            },
          }),
        ],
      },
    });
    const snapshot = buildSubscriptionUsageSnapshot(input, deepLink);
    expect(snapshot.providers[0]?.detail).toBe("Subscription remaining");
    expect(snapshot.providers[0]?.windows[0]?.remaining).toBe(20);
    const failed = provider({
      instanceId: ProviderInstanceId.make("other-account"),
      auth: { status: "authenticated", email: "other@example.com" },
      usageLimits: {
        checkedAt,
        windows: [],
        unavailable: { reason: "probeFailed", message: "Fixture probe failed" },
      },
    });
    const local = input.get(EnvironmentId.make("env"))!.serverConfig;
    const dreamScope = new Set(input.keys());
    const authenticatedSnapshot = buildSubscriptionUsageSnapshot(
      input,
      deepLink,
      Infinity,
      dreamScope,
    );
    const signedOut = provider({
      instanceId: ProviderInstanceId.make("not-signed-in"),
      auth: { status: "unauthenticated" },
      usageLimits: undefined,
    });
    local.providers = [...local.providers, signedOut];
    expect
      .soft(buildSubscriptionUsageSnapshot(input, deepLink, Infinity, dreamScope))
      .toEqual(authenticatedSnapshot);
    local.providers = local.providers.filter((entry) => entry !== signedOut);
    local.providers = [...local.providers, failed];
    expect(
      buildSubscriptionUsageSnapshot(input, deepLink, Infinity, dreamScope).providers[0],
    ).toMatchObject({
      windows: [{ remaining: 20 }],
      partial: true,
    });
    local.providers = [
      provider(),
      provider({ ...failed, availability: "unavailable", usageLimits: limits }),
    ];
    expect
      .soft(buildSubscriptionUsageSnapshot(input, deepLink, Infinity, dreamScope).providers[0])
      .toMatchObject({
        windows: [{ remaining: 20 }],
        partial: true,
      });
    local.providers = [
      provider({ usageLimits: { checkedAt, windows: [{ ...window, usedPercent: 20 }] } }),
    ];
    input.get(EnvironmentId.make("other"))!.serverConfig.providers = [
      provider({
        auth: { status: "authenticated", email: "offline@example.com" },
        usageLimits: { checkedAt, windows: [{ ...window, usedPercent: 80 }] },
      }),
    ];
    expect(
      buildSubscriptionUsageSnapshot(input, deepLink).providers[0]?.windows[0]?.remaining,
    ).toBe(50);
    expect
      .soft(
        buildSubscriptionUsageSnapshot(
          input,
          deepLink,
          Infinity,
          new Set([EnvironmentId.make("env")]),
        ).providers[0]?.windows[0]?.remaining,
      )
      .toBe(80);
    expect
      .soft(buildSubscriptionUsageSnapshot(input, deepLink, Infinity, new Set()).providers)
      .toEqual([]);
  });
});

describe("widget refresh probes", () => {
  it("does not overlap a slow probe even after the refresh interval", async () => {
    let finish!: () => void;
    const probe = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const refresh = createWidgetRefresher(probe);
    const first = refresh(["one", "one"], now);
    await refresh(["one"], now + WIDGET_REFRESH_INTERVAL);
    expect(probe).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });
});
