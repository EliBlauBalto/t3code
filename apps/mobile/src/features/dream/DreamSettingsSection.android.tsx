import { useRef, useState } from "react";
import { View } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { SettingsDragHandle } from "../settings/components/SettingsDragHandle";
import { DREAM_KPIS, moveDreamSlot, dreamDropIndex, type DreamKpi } from "../../lib/dreamDashboard";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useDreamSources } from "./useDreamDashboard";

const native = requireOptionalNativeModule<{ openDreamSettings(): void }>("T3NativeControls");

export function DreamSettingsSection() {
  const source = useDreamSources();
  const { preferences, ready, save } = source;
  const [drag, setDrag] = useState<{ index: number; translation: number } | null>(null);
  const rowHeights = useRef<number[]>([]);
  const move = (from: number, to: number) =>
    save({
      ...preferences,
      slots: moveDreamSlot(preferences.slots, from, Math.max(0, Math.min(4, to))),
    });
  const toggle = (values: readonly string[], key: string) =>
    values.includes(key) ? values.filter((value) => value !== key) : [...values, key];
  const options = source.threads.filter(
    (thread) => thread.archivedAt === null && thread.deletedAt === null,
  );
  return (
    <SettingsSection
      title="Desk dashboard"
      footer="The clock stays separate. First slot is large; the other four fill the smaller positions in reading order. Usage and quota tiles cover the selected machines, not individual sessions. Choose T3 Code desk dashboard in Android’s screen saver settings, then use its Preview button."
    >
      <View className="gap-3 px-4 py-3">
        <View className="rounded-2xl bg-subtle px-3 py-3">
          <Text className="text-center font-t3-medium">{DREAM_KPIS[preferences.slots[0]!]}</Text>
          {[1, 3].map((start) => (
            <View key={start} className="mt-3 flex-row gap-3">
              {[start, start + 1].map((slot) => (
                <Text key={slot} className="flex-1 text-center text-xs text-foreground-muted">
                  {DREAM_KPIS[preferences.slots[slot]!]}
                </Text>
              ))}
            </View>
          ))}
        </View>
        <Text className="text-xs text-foreground-muted">
          Drag to prioritize. Tap a KPI to replace it or leave the slot empty.
        </Text>
      </View>
      {[0, 1, 2, 3, 4].map((index) => {
        const kpi = preferences.slots[index]!;
        return (
          <View
            key={index}
            onLayout={({ nativeEvent }) => {
              rowHeights.current[index] = nativeEvent.layout.height;
            }}
            style={{
              minHeight: 88,
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 16,
              zIndex: drag?.index === index ? 1 : 0,
              transform: [{ translateY: drag?.index === index ? drag.translation : 0 }],
            }}
          >
            <View className="flex-1 gap-1">
              <Text className="text-xs text-foreground-muted">
                {index === 0 ? "Central" : `Small ${index}`}
              </Text>
              <Menu
                actions={Object.entries(DREAM_KPIS).map(([id, title]) => ({
                  id: id || "empty",
                  title,
                  state: id === kpi ? ("on" as const) : ("off" as const),
                }))}
                onPressAction={({ nativeEvent }) => {
                  const next = nativeEvent.event === "empty" ? "" : nativeEvent.event;
                  if (!Object.hasOwn(DREAM_KPIS, next)) return;
                  const slots = [...preferences.slots];
                  slots[index] = next as DreamKpi;
                  save({ ...preferences, slots });
                }}
              >
                <Button label={DREAM_KPIS[kpi]} tone="text" disabled={!ready} onPress={() => {}} />
              </Menu>
            </View>
            {ready ? (
              <SettingsDragHandle
                title={DREAM_KPIS[kpi]}
                canMoveUp={index > 0}
                canMoveDown={index < 4}
                onStart={() => setDrag({ index, translation: 0 })}
                onMove={(translation) => setDrag({ index, translation })}
                onEnd={(translation, cancelled) => {
                  setDrag(null);
                  if (!cancelled)
                    move(index, dreamDropIndex(rowHeights.current, index, translation));
                }}
                onStep={(direction) => move(index, index + (direction === "up" ? -1 : 1))}
              />
            ) : null}
          </View>
        );
      })}
      <SettingsSwitchRow
        label="Monochrome"
        value={preferences.monochrome}
        disabled={!ready}
        onValueChange={(monochrome) => save({ ...preferences, monochrome })}
      />
      <SettingsSwitchRow
        label="All projects and sessions"
        value={preferences.all}
        disabled={!ready}
        onValueChange={(all) => save({ ...preferences, all })}
      />
      {!preferences.all ? (
        <View className="flex-row flex-wrap gap-3 px-4 py-3">
          <Menu
            actions={source.projects.map((project) => ({
              id: project.key,
              title: project.title,
              state: preferences.projects.includes(project.key)
                ? ("on" as const)
                : ("off" as const),
            }))}
            onPressAction={({ nativeEvent }) =>
              save({ ...preferences, projects: toggle(preferences.projects, nativeEvent.event) })
            }
          >
            <Button
              label={`Projects (${preferences.projects.length})`}
              tone="text"
              disabled={!ready || source.projects.length === 0}
              onPress={() => {}}
            />
          </Menu>
          <Menu
            actions={options.map((thread) => ({
              id: scopedThreadKey(thread.environmentId, thread.id),
              title: thread.title,
              subtitle: source.presentations.get(thread.environmentId)?.entry.target.label,
              state: preferences.threads.includes(scopedThreadKey(thread.environmentId, thread.id))
                ? ("on" as const)
                : ("off" as const),
            }))}
            onPressAction={({ nativeEvent }) =>
              save({ ...preferences, threads: toggle(preferences.threads, nativeEvent.event) })
            }
          >
            <Button
              label={`Sessions (${preferences.threads.length})`}
              tone="text"
              disabled={!ready || options.length === 0}
              onPress={() => {}}
            />
          </Menu>
        </View>
      ) : null}
      <View className="px-4 py-3">
        <Button
          label="Android screen saver settings"
          disabled={typeof native?.openDreamSettings !== "function"}
          onPress={() => native?.openDreamSettings?.()}
        />
      </View>
    </SettingsSection>
  );
}
