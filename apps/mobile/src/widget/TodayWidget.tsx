'use no memo';
/** The home screen widget: today's tasks, ticked off with a tap, the app opened from the title. */
import type { Task } from '@sirius/contracts';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { Colors } from '../theme.ts';

const SHOWN = 6;

export function TodayWidget({
  tasks,
  colors,
  note,
}: {
  tasks: Task[];
  colors: Colors;
  note?: string;
}) {
  const open = tasks.filter((t) => t.status === 'open');
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: colors.panel as `#${string}`,
        borderRadius: 20,
        padding: 14,
        flexDirection: 'column',
      }}
      accessibilityLabel="Sirius, today"
    >
      <FlexWidget
        clickAction="OPEN_APP"
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <TextWidget
          text="Today"
          style={{ fontSize: 20, fontFamily: 'serif', color: colors.ink as `#${string}` }}
        />
        <TextWidget
          text={note ?? (open.length ? `${open.length} open` : 'All done')}
          style={{ fontSize: 13, fontFamily: 'serif', color: colors.muted as `#${string}` }}
        />
      </FlexWidget>
      {tasks.slice(0, SHOWN).map((t) => (
        <FlexWidget
          key={t.id}
          clickAction="TOGGLE"
          clickActionData={{ id: t.id, status: t.status }}
          style={{
            width: 'match_parent',
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 5,
          }}
        >
          <TextWidget
            text={t.status === 'done' ? '●' : '○'}
            style={{ fontSize: 17, color: colors.ink as `#${string}`, marginRight: 10 }}
          />
          <TextWidget
            text={t.title}
            maxLines={1}
            truncate="END"
            style={{
              fontSize: 16,
              fontFamily: 'serif',
              color: (t.status === 'done' ? colors.muted : colors.ink) as `#${string}`,
            }}
          />
        </FlexWidget>
      ))}
      {tasks.length === 0 && (
        <TextWidget
          text="Nothing yet. Add one in Sirius."
          style={{ fontSize: 15, fontFamily: 'serif', color: colors.muted as `#${string}` }}
        />
      )}
    </FlexWidget>
  );
}
