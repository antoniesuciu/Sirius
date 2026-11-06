import { useGoals, useLearning, useOp } from '@sirius/client';
import { StyleSheet, Text, View } from 'react-native';
import type { Colors } from '../theme.ts';
import { AddField, Card, Muted, TextButton } from '../ui.tsx';

export function Plan({ colors }: { colors: Colors }) {
  const goals = useGoals().data ?? [];
  const roadmaps = useLearning().data ?? [];
  const addGoal = useOp('add_goal', ['list_goals']);
  const stepToToday = useOp('step_to_today', ['get_today']);
  return (
    <View style={s.stack}>
      <Card title="Goals" colors={colors}>
        {goals.length === 0 && <Muted colors={colors}>No goals yet.</Muted>}
        {goals.map((g) => {
          const done = g.milestones.filter((m) => m.done_at !== null).length;
          return (
            <View key={g.id} style={s.item}>
              <Text style={[s.title, { color: colors.ink }]}>{g.title}</Text>
              <Text style={[s.small, { color: colors.muted }]}>
                {[
                  g.horizon_text,
                  g.milestones.length ? `${done} of ${g.milestones.length} milestones` : null,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </Text>
            </View>
          );
        })}
        <AddField
          placeholder="Add a goal"
          onAdd={(title) => addGoal.mutate({ title })}
          colors={colors}
        />
      </Card>
      <Card title="Learning" colors={colors}>
        {roadmaps.length === 0 && (
          <Muted colors={colors}>No roadmaps yet. Ask Sirius to plan one.</Muted>
        )}
        {roadmaps.map((r) => {
          const next = r.steps.find((step) => step.status === 'todo');
          const done = r.steps.filter((step) => step.status === 'done').length;
          return (
            <View key={r.id} style={s.item}>
              <Text style={[s.title, { color: colors.ink }]}>{r.title}</Text>
              <Text style={[s.small, { color: colors.muted }]}>
                {done} of {r.steps.length} milestones
              </Text>
              {next && (
                <View style={s.next}>
                  <Text style={[s.small, { color: colors.ink, flex: 1 }]}>Next: {next.title}</Text>
                  <TextButton
                    label="Put it in Today"
                    onPress={() => stepToToday.mutate({ id: next.id })}
                    colors={colors}
                  />
                </View>
              )}
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const s = StyleSheet.create({
  stack: { gap: 16 },
  item: { gap: 2, paddingVertical: 4 },
  title: { fontFamily: 'serif', fontSize: 19 },
  small: { fontFamily: 'serif', fontSize: 15 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
});
