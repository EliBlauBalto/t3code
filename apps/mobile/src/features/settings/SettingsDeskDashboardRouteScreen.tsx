import { Alert, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";

import { AppText as Text } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListRow } from "../../components/ui/ListRow";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { cn } from "../../lib/cn";
import {
  DREAM_BRIGHTNESS,
  DREAM_CLOCKS,
  DREAM_KPIS,
  DREAM_LAYOUTS,
  DREAM_PALETTES,
  assignDreamSlot,
  normalizeDreamPreferences,
  type DreamKpi,
  type DreamLayout,
  type DreamPalette,
  type DreamPreferences,
} from "../../lib/dreamDashboard";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useDreamSources } from "../dream/useDreamDashboard";
import { DreamPreview } from "../dream/DreamPreview";
import { resolveDreamPalette } from "../dream/DreamScene";
import { useAppearancePreferences } from "./appearance/AppearancePreferencesProvider";
import { DreamSelectionSheet } from "../dream/DreamSelectionSheet";
import { dreamControls, supportsDream } from "../../lib/dreamSupport";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

const KPI_ACTIONS = Object.entries(DREAM_KPIS).map(([id, title]) => ({
  id: id || "empty",
  title,
  subtitle: id === "input" ? "Approvals and guest messages" : undefined,
}));

const options = <Value extends string>(labels: Record<Value, string>) =>
  (Object.keys(labels) as Value[])
    .sort((first, second) => (first === "system" ? -1 : second === "system" ? 1 : 0))
    .map((value) => ({ value, label: labels[value] }));

const defaults = normalizeDreamPreferences(undefined);
const layoutDescriptions: Record<DreamLayout, string> = {
  dashboard: "Time, session activity and a few useful readings.",
  focus: "One reading, given the whole screen.",
  clock: "Time first. A quiet session summary below.",
};

function LayoutChoice(props: {
  readonly selected: DreamLayout;
  readonly palette: DreamPalette;
  readonly disabled: boolean;
  readonly onSelect: (layout: DreamLayout) => void;
}) {
  const { themeVariablesByAppearance } = useAppearancePreferences();
  const colors = resolveDreamPalette(props.palette, themeVariablesByAppearance.dark);
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Screen saver style"
      className="flex-row gap-2 p-3"
    >
      {options(DREAM_LAYOUTS).map(({ value, label }) => (
        <Pressable
          key={value}
          accessibilityRole="radio"
          accessibilityLabel={`${label} style`}
          accessibilityState={{ checked: props.selected === value, disabled: props.disabled }}
          disabled={props.disabled}
          onPress={() => props.onSelect(value)}
          className={cn(
            "flex-1 items-center gap-3 rounded-2xl border p-2 pb-3 active:opacity-70",
            props.selected === value ? "border-primary bg-primary/10" : "border-border-subtle",
            props.disabled && "opacity-45",
          )}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={{
              width: "100%",
              height: 92,
              borderRadius: 10,
              padding: 9,
              backgroundColor: colors.screen,
              overflow: "hidden",
            }}
          >
            <View
              style={{ flex: 1, justifyContent: value === "clock" ? "center" : "space-between" }}
            >
              <Text
                allowFontScaling={false}
                className="font-t3-medium"
                style={{
                  color: colors.foreground,
                  fontSize: value === "clock" ? 27 : value === "dashboard" ? 23 : 10,
                }}
              >
                9:41
              </Text>
              {value !== "clock" ? (
                <View>
                  <Text
                    allowFontScaling={false}
                    className="font-t3-medium"
                    style={{
                      color: colors.foreground,
                      fontSize: value === "focus" ? 15 : 10,
                      lineHeight: value === "focus" ? 17 : 12,
                    }}
                  >
                    1 session{"\n"}
                    <Text style={{ color: colors.accent }}>needs you.</Text>
                  </Text>
                  {value === "dashboard" ? (
                    <View
                      style={{
                        marginTop: 7,
                        borderTopWidth: 1,
                        borderColor: "#333",
                        paddingTop: 4,
                      }}
                    >
                      <Text allowFontScaling={false} style={{ color: "#aaa", fontSize: 8 }}>
                        300K $0.96 36%
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            textRole="footnote"
            className="text-center font-t3-medium"
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function ReadingChoice(props: {
  readonly kpi: DreamKpi;
  readonly index: number;
  readonly disabled: boolean;
  readonly onChange: (kpi: DreamKpi) => void;
}) {
  const label = props.index === 0 ? "Main reading" : "Reading " + props.index;
  return (
    <DreamSelectionSheet
      title={label}
      options={
        props.index === 0 ? KPI_ACTIONS.filter((option) => option.id !== "empty") : KPI_ACTIONS
      }
      selected={[props.kpi || "empty"]}
      disabled={props.disabled}
      onSelect={(id) => {
        const next = id === "empty" ? "" : id;
        if (Object.hasOwn(DREAM_KPIS, next)) props.onChange(next as DreamKpi);
      }}
    >
      {(open) => (
        <ListRow
          label={`${label}: ${DREAM_KPIS[props.kpi]}`}
          disabled={props.disabled}
          onPress={open}
        />
      )}
    </DreamSelectionSheet>
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
    <View
      accessible={props.disabled}
      accessibilityLabel={`${props.label}: ${props.values[props.selected]}`}
      accessibilityState={{ disabled: props.disabled }}
      pointerEvents={props.disabled ? "none" : "auto"}
      className={cn("gap-2 px-4 py-3", props.disabled && "opacity-45")}
    >
      <Text textRole="footnote" className="text-foreground-muted">
        {props.label}
      </Text>
      <SegmentedControl
        variant="card"
        options={options(props.values).map((option) => ({
          ...option,
          accessibilityLabel: `${props.label}: ${option.label}`,
        }))}
        selected={props.selected}
        onSelect={props.disabled ? () => {} : props.onSelect}
      />
    </View>
  );
}

const count = (value: number, noun: string) =>
  value === 0 ? "None" : `${value} ${noun}${value === 1 ? "" : "s"}`;

export function SettingsDeskDashboardRouteScreen() {
  const navigation = useNavigation();
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
  const canOpenScreenSaver = supportsDream();
  const unavailableOption = (noun: string) => (key: string) => {
    const machine = [...source.presentations].find(([id]) => key.startsWith(`${id}:`));
    const identity = machine ? key.slice(machine[0].length + 1) : key;
    const status = machine
      ? `${machine[1].entry.target.label} · ${source.live.has(machine[0]) ? "No longer listed" : "Offline"}`
      : "Removed or unknown machine";
    return {
      title: `Unavailable ${noun}`,
      subtitle: `${identity} · ${status}`,
    };
  };
  const customized = (Object.keys(defaults) as (keyof DreamPreferences)[]).some(
    (key) =>
      !["all", "projects", "threads"].includes(key) &&
      JSON.stringify(preferences[key]) !== JSON.stringify(defaults[key]),
  );
  let selectionFooter =
    "Choose what feeds your session counts. Your selection applies to every style.";
  if (!preferences.all && source.environmentIds.size === 0) {
    selectionFooter =
      preferences.projects.length + preferences.threads.length > 0
        ? "Your saved choices are no longer available. Choose a project or session to see live status."
        : "Nothing selected. Choose a project or session to see live status.";
  }

  return (
    <SettingsScreen title="Desk dashboard">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {!canOpenScreenSaver ? (
          <Text textRole="body" className="px-4 text-foreground-muted">
            Screen savers aren’t available on this device.
          </Text>
        ) : (
          <>
            <SettingsSection title="Style">
              <LayoutChoice
                selected={preferences.layout}
                palette={preferences.palette}
                disabled={!ready}
                onSelect={set("layout")}
              />
              <Text textRole="footnote" className="px-4 pb-3 text-foreground-muted">
                {layoutDescriptions[preferences.layout]}
              </Text>
              <DreamPreview source={source} />
              <ListActionRow
                label="Set as screen saver"
                description="Choose T3 Code in Android settings and enable it while charging."
                onPress={() => {
                  if (dreamControls?.openDreamSettings() === false) {
                    Alert.alert(
                      "Screen saver settings unavailable",
                      "Android couldn't open screen saver settings. Check your device's display settings or try again later.",
                    );
                  }
                }}
              />
              {source.environmentIds.size === 0 && preferences.all ? (
                <ListActionRow
                  label="Connect a machine"
                  onPress={() => navigation.navigate("SettingsEnvironments")}
                />
              ) : null}
            </SettingsSection>
            {preferences.layout !== "clock" ? (
              <SettingsSection
                title={preferences.layout === "focus" ? "Focus reading" : "Readings"}
                footer={
                  preferences.layout === "focus"
                    ? "Focus shows the first reading. Usage and quota cover your selected machines."
                    : "Session status stays at the top. Other readings follow your chosen order. Usage and quota cover selected machines."
                }
              >
                {(preferences.layout === "focus" ? [0] : [0, 1, 2, 3, 4]).map((index) => (
                  <ReadingChoice
                    key={index}
                    kpi={preferences.slots[index]!}
                    index={index}
                    disabled={!ready}
                    onChange={(kpi) =>
                      save((current) => ({ slots: assignDreamSlot(current.slots, index, kpi) }))
                    }
                  />
                ))}
              </SettingsSection>
            ) : null}

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
                label="Shift display gently"
                subtitle="Moves the layout slightly each minute."
                value={preferences.pixelShift}
                disabled={!ready}
                onValueChange={set("pixelShift")}
              />
            </SettingsSection>

            <SettingsSection title="Sessions" footer={selectionFooter}>
              <SettingsSwitchRow
                label="All projects and sessions"
                value={preferences.all}
                disabled={!ready}
                onValueChange={set("all")}
              />
              {!preferences.all ? (
                <>
                  <DreamSelectionSheet
                    title="Projects"
                    multiple
                    options={source.projects.map((project) => ({
                      id: project.key,
                      title: project.title,
                    }))}
                    selected={preferences.projects}
                    unavailableOption={unavailableOption("project")}
                    disabled={!source.initialized}
                    onClear={() => save({ projects: [] })}
                    onSelect={(id) =>
                      save((current) => ({ projects: toggle(current.projects, id) }))
                    }
                  >
                    {(open) => (
                      <ListActionRow
                        label="Projects"
                        detail={count(preferences.projects.length, "project")}
                        disabled={
                          !source.initialized ||
                          (source.projects.length === 0 && preferences.projects.length === 0)
                        }
                        onPress={open}
                      />
                    )}
                  </DreamSelectionSheet>
                  <DreamSelectionSheet
                    title="Sessions"
                    multiple
                    options={sessions.map((thread) => ({
                      id: scopedThreadKey(thread.environmentId, thread.id),
                      title: thread.title,
                      subtitle: source.presentations.get(thread.environmentId)?.entry.target.label,
                    }))}
                    selected={preferences.threads}
                    unavailableOption={unavailableOption("session")}
                    disabled={!source.initialized}
                    onClear={() => save({ threads: [] })}
                    onSelect={(id) => save((current) => ({ threads: toggle(current.threads, id) }))}
                  >
                    {(open) => (
                      <ListActionRow
                        label="Sessions"
                        detail={count(preferences.threads.length, "session")}
                        disabled={
                          !source.initialized ||
                          (sessions.length === 0 && preferences.threads.length === 0)
                        }
                        onPress={open}
                      />
                    )}
                  </DreamSelectionSheet>
                </>
              ) : null}
            </SettingsSection>

            <SettingsSection title="Reset">
              <ListActionRow
                label="Reset readings and look"
                description="Keeps your project and session choices."
                disabled={!ready || !customized}
                onPress={() =>
                  save({
                    layout: defaults.layout,
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
          </>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}
