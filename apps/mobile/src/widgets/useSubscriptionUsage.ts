import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { environmentCatalog } from "../connection/catalog";
import { isAppActive, subscribeAppState } from "../lib/appState";
import { appAtomRegistry } from "../state/atom-registry";
import { environmentPresentations } from "../state/presentation";
import { serverEnvironment } from "../state/server";
import { createWidgetRefresher, WIDGET_REFRESH_INTERVAL } from "./subscriptionUsageSnapshot";

export function installSubscriptionUsageRefresh(
  isVisible = isAppActive,
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null = null,
): () => void {
  const refresh = createWidgetRefresher((environmentId: EnvironmentId) =>
    runAtomCommand(
      appAtomRegistry,
      serverEnvironment.refreshProviders,
      { environmentId, input: {} },
      { label: serverEnvironment.refreshProviders.label, reportFailure: false },
    ),
  );
  const update = () => {
    if (!isVisible() || !appAtomRegistry.get(environmentCatalog.catalogValueAtom).isReady) return;
    const connected = [...appAtomRegistry.get(environmentPresentations.presentationsAtom)]
      .filter(
        ([id, presentation]) =>
          presentation.connection.phase === "connected" &&
          (selectedEnvironmentIds === null || selectedEnvironmentIds.has(id)),
      )
      .map(([id]) => id);
    void refresh(connected, Date.now());
  };

  const unsubscribeCatalog = appAtomRegistry.subscribe(environmentCatalog.catalogValueAtom, update);
  const unsubscribePresentations = appAtomRegistry.subscribe(
    environmentPresentations.presentationsAtom,
    update,
    { immediate: true },
  );
  const unsubscribeAppState = subscribeAppState(update);
  const timer = setInterval(update, WIDGET_REFRESH_INTERVAL);
  return () => {
    unsubscribeCatalog();
    unsubscribePresentations();
    unsubscribeAppState();
    clearInterval(timer);
  };
}
