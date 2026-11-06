import { useAddToList, useList, useOp, useReminders, useTickListItem } from '@sirius/client';
import { StyleSheet, Switch, Text, View } from 'react-native';
import type { Colors } from '../theme.ts';
import { AddField, Card, CheckRow, Muted } from '../ui.tsx';

export function List({ colors }: { colors: Colors }) {
  const items = useList().data ?? [];
  const add = useAddToList();
  const tick = useTickListItem();
  const reminders = useReminders().data ?? [];
  const setEnabled = useOp('set_reminder_enabled', ['list_reminders']);
  return (
    <View style={s.stack}>
      <Card title="To remember" colors={colors}>
        {items.length === 0 && <Muted colors={colors}>Milk, a birthday card…</Muted>}
        {items.map((item) => (
          <CheckRow
            key={item.id}
            label={item.text}
            done={item.done_at !== null}
            onPress={() => tick.mutate(item)}
            colors={colors}
          />
        ))}
        <AddField
          placeholder="Something to remember"
          onAdd={(text) => add.mutate(text)}
          colors={colors}
        />
      </Card>
      <Card title="Reminders" colors={colors}>
        {reminders.length === 0 && (
          <Muted colors={colors}>No reminders. Ask Sirius to set one.</Muted>
        )}
        {reminders.map((r) => (
          <View key={r.id} style={s.reminder}>
            <View style={s.text}>
              <Text style={[s.label, { color: colors.ink }]}>{r.label}</Text>
              <Text style={[s.small, { color: colors.muted }]}>{r.time_local}</Text>
            </View>
            <Switch
              value={r.enabled}
              onValueChange={(enabled) => setEnabled.mutate({ id: r.id, enabled })}
              trackColor={{ true: colors.ink, false: colors.lineMid }}
              thumbColor={colors.panel}
              accessibilityLabel={r.label}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}

const s = StyleSheet.create({
  stack: { gap: 16 },
  reminder: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  text: { flex: 1 },
  label: { fontFamily: 'serif', fontSize: 18 },
  small: { fontFamily: 'serif', fontSize: 14 },
});
