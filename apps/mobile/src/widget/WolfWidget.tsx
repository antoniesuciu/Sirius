'use no memo';
/** The one-cell widget: just the wolf, which opens Sirius already listening. */
import { FlexWidget, SvgWidget } from 'react-native-android-widget';
import type { Colors } from '../theme.ts';
import { LISTEN_URL } from '../web.ts';
import { wolfSvg } from './wolf.ts';

export function WolfWidget({ colors }: { colors: Colors }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: LISTEN_URL }}
      accessibilityLabel="Talk to Sirius"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: colors.panel as `#${string}`,
        borderRadius: 999,
        padding: 4,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <SvgWidget svg={wolfSvg(colors)} style={{ height: 'match_parent', width: 'match_parent' }} />
    </FlexWidget>
  );
}
