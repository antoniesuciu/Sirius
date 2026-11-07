'use no memo';
/**
 * The home screen widget: today's tasks, then the things to remember, in one list that
 * scrolls. A tap ticks a task (or unticks it) and ticks an item off. The wolf opens Sirius
 * listening; the title opens it without the microphone.
 */
import { FlexWidget, ListWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import type { Colors } from '../theme.ts';
import { LISTEN_URL } from '../web.ts';
import { fontsFor, type WidgetItem, type WidgetTask } from './snapshot.ts';
import { wolfSvg } from './wolf.ts';

type Hex = `#${string}`;

export function TodayWidget({
  tasks,
  list,
  colors,
  theme,
  compact = false,
  note,
}: {
  tasks: WidgetTask[];
  list: WidgetItem[];
  colors: Colors;
  theme: string;
  /** About two rows high: a smaller header and tighter rows, so more of the list shows. */
  compact?: boolean;
  note?: string;
}) {
  const fonts = fontsFor(theme);
  const ink = colors.ink as Hex;
  const muted = colors.muted as Hex;
  const open = tasks.filter((t) => t.status === 'open');
  // The list's rows are drawn as pictures the full width of the widget and ignore the panel's
  // padding, so every part carries its own side padding instead (seen on the Honor, 2026-11-07).
  const side = compact ? 10 : 14;
  const row = (
    key: string,
    mark: string,
    text: string,
    faded: boolean,
    clickAction: string,
    clickActionData: Record<string, string>,
  ) => (
    <FlexWidget
      key={key}
      clickAction={clickAction}
      clickActionData={clickActionData}
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: compact ? 4 : 6,
        paddingHorizontal: side,
      }}
    >
      <TextWidget
        text={mark}
        style={{ fontSize: 17, fontFamily: fonts.text, color: ink, marginRight: 10 }}
      />
      <TextWidget
        text={text}
        maxLines={1}
        truncate="END"
        style={{ fontSize: 16, fontFamily: fonts.text, color: faded ? muted : ink }}
      />
    </FlexWidget>
  );
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: colors.panel as Hex,
        borderRadius: 20,
        paddingVertical: side,
        flexDirection: 'column',
      }}
      accessibilityLabel="Sirius, today"
    >
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: compact ? 2 : 6,
          paddingHorizontal: side,
        }}
      >
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={{ uri: LISTEN_URL }}
            accessibilityLabel="Talk to Sirius"
            style={{ marginRight: 10 }}
          >
            <SvgWidget
              svg={wolfSvg(colors)}
              style={{ height: compact ? 38 : 52, width: compact ? 38 : 52 }}
            />
          </FlexWidget>
          <TextWidget
            text="Today"
            clickAction="OPEN_APP"
            style={{ fontSize: compact ? 20 : 24, fontFamily: fonts.title, color: ink }}
          />
        </FlexWidget>
        <TextWidget
          text={note ?? (open.length ? `${open.length} open` : 'All done')}
          clickAction="OPEN_APP"
          style={{ fontSize: 14, fontFamily: fonts.text, color: muted }}
        />
      </FlexWidget>
      <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
        {tasks.length === 0
          ? [
              <FlexWidget
                key="empty"
                clickAction="OPEN_APP"
                style={{ paddingVertical: 6, paddingHorizontal: side }}
              >
                <TextWidget
                  text="Nothing yet. Add one in Sirius."
                  style={{ fontSize: 15, fontFamily: fonts.text, color: muted }}
                />
              </FlexWidget>,
            ]
          : tasks.map((t) =>
              row(t.id, t.status === 'done' ? '●' : '○', t.title, t.status === 'done', 'TOGGLE', {
                id: t.id,
                status: t.status,
              }),
            )}
        {list.length > 0 && (
          <FlexWidget
            key="remember"
            style={{ paddingTop: 12, paddingBottom: 2, paddingHorizontal: side }}
          >
            <TextWidget
              text="To remember"
              style={{ fontSize: 17, fontFamily: fonts.title, color: ink }}
            />
          </FlexWidget>
        )}
        {list.map((i) => row(i.id, '○', i.text, false, 'TICK_ITEM', { id: i.id }))}
      </ListWidget>
    </FlexWidget>
  );
}
