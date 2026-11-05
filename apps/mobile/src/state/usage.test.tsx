import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, UsageDay } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({ requested: [] as string[] }));
vi.mock("./atom-registry", () => ({ appAtomRegistry: {} }));
vi.mock("./presentation", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    environmentPresentations: {
      presentationsAtom: Atom.make(
        new Map(
          ["a", "b"].map((id) => [
            id,
            { connection: { phase: "connected" }, entry: { target: { label: id } } },
          ]),
        ),
      ),
    },
  };
});
vi.mock("./session", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const { AuthDiagnosticsReadScope } = await import("@t3tools/contracts");
  return {
    environmentSession: {
      sessionStateAtom: () =>
        Atom.make(
          AsyncResult.success({ authenticated: true, permissions: [AuthDiagnosticsReadScope] }),
        ),
    },
    readEnvironmentScope: () => true,
  };
});
vi.mock("./server", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  return {
    serverEnvironment: {
      usageSummary: ({ environmentId }: { environmentId: string }) => {
        fixture.requested.push(environmentId);
        return Atom.make(AsyncResult.initial());
      },
      usageModelFilterAtom: () => Atom.make(undefined),
      providersValueAtom: () => Atom.make([]),
    },
  };
});

import { useUsage } from "./usage";

it.each([
  { name: "selected metrics", ids: ["a"], scoped: true, requested: ["a"] },
  { name: "hidden metrics", ids: [], scoped: true, requested: [] },
  { name: "normal usage screen", ids: ["a"], scoped: false, requested: ["a", "b"] },
])("queries only the required machines for $name", ({ ids, scoped, requested }) => {
  fixture.requested = [];
  const registry = AtomRegistry.make();
  function ReadUsage() {
    useUsage(
      {
        sinceDay: UsageDay.make("2026-11-04"),
        untilDay: UsageDay.make("2026-11-04"),
        timeZone: "UTC",
      },
      new Set(ids.map((id) => EnvironmentId.make(id))),
      { querySelectedOnly: scoped },
    );
    return null;
  }
  try {
    renderToString(
      createElement(RegistryContext.Provider, { value: registry }, createElement(ReadUsage)),
    );
    expect(fixture.requested).toEqual(requested);
  } finally {
    registry.dispose();
  }
});
