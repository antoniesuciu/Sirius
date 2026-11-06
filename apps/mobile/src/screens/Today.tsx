import { useAddTask, useToday, useToggleTask } from '@sirius/client';
import { StyleSheet, Text, View } from 'react-native';
import type { Colors } from '../theme.ts';
import { AddField, Card, CheckRow, Muted } from '../ui.tsx';

export function Today({ colors }: { colors: Colors }) {
  const today = useToday().data;
  const toggle = useToggleTask();
  const add = useAddTask();
  const tasks = today?.tasks ?? [];
  const priorities = tasks.filter((t) => t.tier === 'priority');
  const smalls = tasks.filter((t) => t.tier === 'small');
  return (
    <View style={s.stack}>
      <Card title="Today" colors={colors}>
        {tasks.length === 0 && <Muted colors={colors}>Nothing yet. Add one, or ask Sirius.</Muted>}
        {priorities.map((t) => (
          <CheckRow
            key={t.id}
            label={t.title}
            done={t.status === 'done'}
            onPress={() => toggle.mutate(t)}
            colors={colors}
          />
        ))}
        {priorities.length > 0 && smalls.length > 0 && (
          <View style={[s.rule, { backgroundColor: colors.lineMid }]} />
        )}
        {smalls.map((t) => (
          <CheckRow
            key={t.id}
            label={t.title}
            done={t.status === 'done'}
            onPress={() => toggle.mutate(t)}
            colors={colors}
          />
        ))}
        <AddField placeholder="Add a task" onAdd={(title) => add.mutate(title)} colors={colors} />
      </Card>
      <Card title="Schedule" colors={colors}>
        {(today?.schedule ?? []).length === 0 && (
          <Muted colors={colors}>Nothing scheduled today.</Muted>
        )}
        {(today?.schedule ?? []).map((o) => (
          <View key={`${o.event_id}-${o.start_local}`} style={s.event}>
            <Text style={[s.time, { color: colors.muted }]}>
              {o.start_local}
              {o.end_local ? `–${o.end_local}` : ''}
            </Text>
            <View style={s.eventText}>
              <Text style={[s.eventTitle, { color: colors.ink }]}>{o.title}</Text>
              {o.location ? (
                <Text style={[s.where, { color: colors.muted }]}>{o.location}</Text>
              ) : null}
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

const s = StyleSheet.create({
  stack: { gap: 16 },
  rule: { height: 1, marginVertical: 4 },
  event: { flexDirection: 'row', gap: 14 },
  time: { fontFamily: 'serif', fontSize: 16, minWidth: 96 },
  eventText: { flex: 1 },
  eventTitle: { fontFamily: 'serif', fontSize: 18 },
  where: { fontFamily: 'serif', fontSize: 14 },
});
