import { requireOptionalNativeModule } from "expo";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { Menu } from "../../components/ui/Menu";
import { RowPressable } from "../../components/ui/RowPressable";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { cn } from "../../lib/cn";
import {
  DREAM_BRIGHTNESS,
  DREAM_CLOCKS,
  DREAM_KPIS,
  DREAM_PALETTES,
  assignDreamSlot,
  normalizeDreamPreferences,
  type DreamKpi,
  type DreamPreferences,
} from "../../lib/dreamDashboard";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useDreamSources } from "../dream/useDreamDashboard";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

const native = requireOptionalNativeModule<{ openDreamSettings(): void }>("T3NativeControls");

const KPI_ACTIONS = Object.entries(DREAM_KPIS).map(([id, title]) => ({
  id: id || "empty",
  title,
}));

const options = <Value extends string>(labels: Record<Value, string>) =>
  (Object.keys(labels) as Value[]).map((value) => ({ value, label: labels[value] }));

const defaults = normalizeDreamPreferences(undefined);

function SlotTile(props: {
  readonly kpi: DreamKpi;
  readonly index: number;
  readonly disabled: boolean;
  readonly onChange: (kpi: DreamKpi) => void;
}) {
  const central = props.index === 0;
  return (
    <Menu
      style={central ? undefined : { flex: 1 }}
      actions={KPI_ACTIONS.map((action) => ({
        ...action,
        state: action.id === (props.kpi || "empty") ? ("on" as const) : ("off" as const),
      }))}
      onPressAction={({ nativeEvent }) => {
        const next = nativeEvent.event === "empty" ? "" : nativeEvent.event;
        if (Object.hasOwn(DREAM_KPIS, next)) props.onChange(next as DreamKpi);
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${central ? "Large tile" : `Small tile ${props.index}`}: ${DREAM_KPIS[props.kpi]}`}
        accessibilityHint="Choose what this tile shows"
        disabled={props.disabled}
        onPress={() => {}}
        className={cn(
          "items-center justify-center rounded-2xl border px-3 active:opacity-70",
          central ? "h-28 border-primary/40 bg-primary/10" : "h-20 border-border-subtle bg-subtle",
          props.disabled && "opacity-45",
        )}
      >
        <Text
          numberOfLines={2}
          textRole={central ? "headline" : "label"}
          className={cn("text-center font-t3-medium", props.kpi === "" && "text-foreground-muted")}
        >
          {DREAM_KPIS[props.kpi]}
        </Text>
      </Pressable>
    </Menu>
  );
}

function Choice<Value extends string>(props: {
  readonly label: string;
  readonly values: Record<Value, string>;
  readonly selected: Value;
  readonly disabled: boolean;
  readonly onSelect: (value: Value) => void;
}) {
  return (
    <View className={cn("gap-2 px-4 py-3", props.disabled && "opacity-45")}>
      <Text textRole="footnote" className="text-foreground-muted">
        {props.label}
      </Text>
      <SegmentedControl
        variant="card"
        options={options(props.values)}
        selected={props.selected}
        onSelect={props.disabled ? () => {} : props.onSelect}
      />
    </View>
  );
}

const count = (value: number, noun: string) =>
  value === 0 ? "None" : `${value} ${noun}${value === 1 ? "" : "s"}`;

export function SettingsDeskDashboardRouteScreen() {
  const insets = useSafeAreaInsets();
  const source = useDreamSources();
  const { preferences, ready, save } = source;
  const set =
    <Key extends keyof DreamPreferences>(key: Key) =>
    (value: DreamPreferences[Key]) =>
      save({ [key]: value });
  const toggle = (values: readonly string[], key: string) =>
    values.includes(key) ? values.filter((value) => value !== key) : [...values, key];
  const sessions = source.threads.filter(
    (thread) => thread.archivedAt === null && thread.deletedAt === null,
  );
  const canOpenScreenSaver = typeof native?.openDreamSettings === "function";
  const customized = (Object.keys(defaults) as (keyof DreamPreferences)[]).some(
    (key) =>
      !["all", "projects", "threads"].includes(key) &&
      JSON.stringify(preferences[key]) !== JSON.stringify(defaults[key]),
  );

  return (
    <SettingsScreen title="Desk dashboard">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection
          title="Tiles"
          footer="Tap a tile to change what it shows. Picking a metric that is already on the dashboard swaps the two. Usage and quota cover the selected machines, not single sessions."
        >
          <View className="gap-3 px-4 py-4">
            <SlotTile
              kpi={preferences.slots[0]!}
              index={0}
              disabled={!ready}
              onChange={(kpi) =>
                save((current) => ({ slots: assignDreamSlot(current.slots, 0, kpi) }))
              }
            />
            {[1, 3].map((start) => (
              <View key={start} className="flex-row gap-3">
                {[start, start + 1].map((index) => (
                  <SlotTile
                    key={index}
                    kpi={preferences.slots[index]!}
                    index={index}
                    disabled={!ready}
                    onChange={(kpi) =>
                      save((current) => ({ slots: assignDreamSlot(current.slots, index, kpi) }))
                    }
                  />
                ))}
              </View>
            ))}
          </View>
        </SettingsSection>

        <SettingsSection title="Look">
          <Choice
            label="Colors"
            values={DREAM_PALETTES}
            selected={preferences.palette}
            disabled={!ready}
            onSelect={set("palette")}
          />
          <Choice
            label="Brightness"
            values={DREAM_BRIGHTNESS}
            selected={preferences.brightness}
            disabled={!ready}
            onSelect={set("brightness")}
          />
          <Choice
            label="Clock"
            values={DREAM_CLOCKS}
            selected={preferences.clock}
            disabled={!ready}
            onSelect={set("clock")}
          />
          <SettingsSwitchRow
            label="Show date"
            value={preferences.showDate}
            disabled={!ready}
            onValueChange={set("showDate")}
          />
          <SettingsSwitchRow
            label="Show connection status"
            value={preferences.showStatus}
            disabled={!ready}
            onValueChange={set("showStatus")}
          />
          <SettingsSwitchRow
            label="Protect screen from burn-in"
            subtitle="Nudges the layout a few pixels every minute."
            value={preferences.pixelShift}
            disabled={!ready}
            onValueChange={set("pixelShift")}
          />
        </SettingsSection>

        <SettingsSection
          title="Sessions"
          footer="Choose which projects and sessions feed the status tiles."
        >
          <SettingsSwitchRow
            label="All projects and sessions"
            value={preferences.all}
            disabled={!ready}
            onValueChange={set("all")}
          />
          {!preferences.all ? (
            <>
              <Menu
                actions={source.projects.map((project) => ({
                  id: project.key,
                  title: project.title,
                  state: preferences.projects.includes(project.key)
                    ? ("on" as const)
                    : ("off" as const),
                }))}
                onPressAction={({ nativeEvent }) =>
                  save((current) => ({ projects: toggle(current.projects, nativeEvent.event) }))
                }
              >
                <RowPressable
                  accessibilityRole="button"
                  disabled={!ready || source.projects.length === 0}
                  onPress={() => {}}
                  className="border-t border-border-subtle bg-grouped-card"
                >
                  <ListRowLayout
                    label="Projects"
                    detail={count(preferences.projects.length, "project")}
                    disabled={!ready || source.projects.length === 0}
                  />
                </RowPressable>
              </Menu>
              <Menu
                actions={sessions.map((thread) => ({
                  id: scopedThreadKey(thread.environmentId, thread.id),
                  title: thread.title,
                  subtitle: source.presentations.get(thread.environmentId)?.entry.target.label,
                  state: preferences.threads.includes(
                    scopedThreadKey(thread.environmentId, thread.id),
                  )
                    ? ("on" as const)
                    : ("off" as const),
                }))}
                onPressAction={({ nativeEvent }) =>
                  save((current) => ({ threads: toggle(current.threads, nativeEvent.event) }))
                }
              >
                <RowPressable
                  accessibilityRole="button"
                  disabled={!ready || sessions.length === 0}
                  onPress={() => {}}
                  className="border-t border-border-subtle bg-grouped-card"
                >
                  <ListRowLayout
                    label="Sessions"
                    detail={count(preferences.threads.length, "session")}
                    disabled={!ready || sessions.length === 0}
                  />
                </RowPressable>
              </Menu>
            </>
          ) : null}
        </SettingsSection>

        <SettingsSection
          title="Android screen saver"
          footer="In Android’s screen saver settings, choose T3 Code desk dashboard, then use Preview. It shows while charging or docked, and a touch exits."
        >
          <ListActionRow
            label="Open screen saver settings"
            disabled={!canOpenScreenSaver}
            onPress={() => native?.openDreamSettings?.()}
          />
          <ListActionRow
            label="Reset tiles and look"
            description="Keeps your project and session choices."
            tone="danger"
            disabled={!ready || !customized}
            onPress={() =>
              save({
                slots: defaults.slots,
                palette: defaults.palette,
                clock: defaults.clock,
                showDate: defaults.showDate,
                showStatus: defaults.showStatus,
                brightness: defaults.brightness,
                pixelShift: defaults.pixelShift,
              })
            }
          />
        </SettingsSection>
      </ScrollView>
    </SettingsScreen>
  );
}
