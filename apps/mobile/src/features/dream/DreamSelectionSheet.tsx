import { useState, type ReactNode } from "react";
import { FlatList, TextInput, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";

import { AppText as Text } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { SelectionRow } from "../../components/ui/SelectionRow";
import { Sheet } from "../../components/ui/Sheet";
import { useAppForeground } from "../../lib/appState";

export function DreamSelectionSheet(props: {
  readonly title: string;
  readonly options: readonly {
    readonly id: string;
    readonly title: string;
    readonly subtitle?: string;
  }[];
  readonly selected: readonly string[];
  readonly multiple?: boolean;
  readonly disabled: boolean;
  readonly onSelect: (id: string) => void;
  readonly onClear?: () => void;
  readonly children: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const options = [
    ...props.options,
    ...props.selected
      .filter((id) => !props.options.some((option) => option.id === id))
      .map((id) => ({ id, title: "Unavailable selection", subtitle: "Remove this saved choice" })),
  ];
  const query = search.trim().toLocaleLowerCase();
  const matches = options.filter((option) =>
    `${option.title} ${option.subtitle ?? ""}`.toLocaleLowerCase().includes(query),
  );
  return (
    <>
      {props.children(() => {
        if (props.disabled) return;
        setSearch("");
        setOpen(true);
      })}
      {open && focused && foreground ? (
        <Sheet title={props.title} onClose={() => setOpen(false)}>
          <FlatList
            data={matches}
            keyExtractor={(option) => option.id}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{ paddingBottom: 24 }}
            ListHeaderComponent={
              props.multiple ? (
                <View className="gap-3 px-4 py-3">
                  <Text textRole="footnote" className="text-foreground-muted">
                    {props.selected.length} selected. Choose several, then close this sheet.
                  </Text>
                  <TextInput
                    accessibilityLabel={`Search ${props.title.toLocaleLowerCase()}`}
                    placeholder="Search"
                    value={search}
                    onChangeText={setSearch}
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="min-h-12 rounded-xl bg-subtle px-3 text-base text-foreground placeholder:text-foreground-muted"
                  />
                  {props.onClear ? (
                    <ListActionRow
                      label="Clear selection"
                      disabled={props.disabled || props.selected.length === 0}
                      onPress={props.onClear}
                    />
                  ) : null}
                </View>
              ) : undefined
            }
            renderItem={({ item }) => (
              <SelectionRow
                title={item.title}
                subtitle={item.subtitle}
                role={props.multiple ? "checkbox" : "radio"}
                selected={props.selected.includes(item.id)}
                disabled={props.disabled}
                onPress={() => {
                  props.onSelect(item.id);
                  if (!props.multiple) setOpen(false);
                }}
              />
            )}
            ListEmptyComponent={
              <Text textRole="body" className="p-4 text-foreground-muted">
                {query ? "No matches" : "No choices available"}
              </Text>
            }
          />
        </Sheet>
      ) : null}
    </>
  );
}
