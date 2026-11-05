import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom, AsyncResult } from "effect/reactivity";
import { useEffect, useMemo, useState } from "react";
import { makeWindow } from "@t3tools/shared/usageFormat";
import { environmentCatalog } from "../../connection/catalog";
import { environmentPresentations } from "../../state/presentation";
import { environmentShell } from "../../state/shell";
import { environmentThreadShells } from "../../state/threads";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { scopedProjectKey } from "../../lib/scopedEntities";
import {
  normalizeDreamPreferences,
  selectDreamThreads,
  type DreamPreferences,
} from "../../lib/dreamDashboard";

const rawSourcesAtom = Atom.make((get) => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  const presentations = get(environmentPresentations.presentationsWithProvidersAtom);
  const threads = get(environmentThreadShells.navigationThreadShellsAtom).flatMap((thread) => {
    const quiet = get(
      environmentThreadShells.quietThreadShellAtom({
        environmentId: thread.environmentId,
        threadId: thread.id,
      }),
    );
    return quiet === null ? [] : [quiet];
  });
  const projects: Array<{ key: string; title: string; environmentId: EnvironmentId }> = [];
  const live = new Set<EnvironmentId>();
  for (const [id, presentation] of presentations) {
    const shell = get(environmentShell.stateValueAtom(id));
    if (presentation.connection.phase === "connected" && shell.status === "live") live.add(id);
    if (shell.snapshot._tag === "Some")
      for (const project of shell.snapshot.value.projects) {
        projects.push({
          key: scopedProjectKey(id, project.id),
          title: `${project.title} · ${presentation.entry.target.label}`,
          environmentId: id,
        });
      }
  }
  return { ready: catalog.isReady, presentations, threads, projects, live };
});
const sourcesAtom = Atom.withEquality(
  rawSourcesAtom,
  (a, b) =>
    a.ready === b.ready &&
    a.presentations === b.presentations &&
    a.threads.length === b.threads.length &&
    a.threads.every((thread, index) => thread === b.threads[index]) &&
    a.live.size === b.live.size &&
    [...a.live].every((id) => b.live.has(id)) &&
    a.projects.length === b.projects.length &&
    a.projects.every((project, index) => {
      const other = b.projects[index]!;
      return (
        project.key === other.key &&
        project.title === other.title &&
        project.environmentId === other.environmentId
      );
    }),
);

export function useDreamSources() {
  const sources = useAtomValue(sourcesAtom);
  const stored = useAtomValue(mobilePreferencesAtom);
  const preferences = normalizeDreamPreferences(
    AsyncResult.isSuccess(stored) ? stored.value.dreamDashboard : undefined,
  );
  const save = useAtomSet(updateMobilePreferencesAtom);
  const selected = selectDreamThreads(sources.threads, preferences);
  const environmentKey = JSON.stringify(
    [
      ...new Set<EnvironmentId>([
        ...selected.map((thread) => thread.environmentId),
        ...sources.projects
          .filter((project) => preferences.all || preferences.projects.includes(project.key))
          .map((project) => project.environmentId),
        ...[...sources.presentations]
          .filter(([id]) =>
            preferences.all
              ? true
              : !sources.live.has(id) &&
                [...preferences.projects, ...preferences.threads].some((key) =>
                  key.startsWith(`${id}:`),
                ),
          )
          .map(([id]) => id),
      ]),
    ].sort(),
  );
  const environmentIds = useMemo(
    () => new Set(JSON.parse(environmentKey) as EnvironmentId[]),
    [environmentKey],
  );
  const initialized = sources.ready && AsyncResult.isSuccess(stored);
  const ready = initialized && !stored.waiting;
  return {
    ...sources,
    ready,
    initialized,
    preferences,
    selected,
    environmentIds,
    save: (
      patch: Partial<DreamPreferences> | ((current: DreamPreferences) => Partial<DreamPreferences>),
    ) =>
      save({
        transform: (current) => {
          const saved = normalizeDreamPreferences(current.dreamDashboard);
          return {
            dreamDashboard: { ...saved, ...(typeof patch === "function" ? patch(saved) : patch) },
          };
        },
      }),
  };
}

const usageWindow = (now: Date) =>
  makeWindow(1, new Date(Math.floor(now.getTime() / 300_000) * 300_000), "hour");

export function useDreamClock() {
  const [clock, setClock] = useState(() => ({
    now: new Date(),
    window: usageWindow(new Date()),
  }));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- advances the clock each minute; usage windows are five-minute snapshots
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          const now = new Date();
          setClock({ now, window: usageWindow(now) });
          schedule();
        },
        60_000 - (Date.now() % 60_000),
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return clock;
}
