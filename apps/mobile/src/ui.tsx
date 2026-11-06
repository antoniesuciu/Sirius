/** The few pieces every screen is built from, in the web app's look: cards on the ground. */
import { type ComponentRef, type ReactNode, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { type Colors, SERIF } from './theme.ts';

export function Card({
  title,
  colors,
  children,
  aside,
}: {
  title: string;
  colors: Colors;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <View style={[s.card, { backgroundColor: colors.panel, borderColor: colors.panelBorder }]}>
      <View style={s.cardHead}>
        <Text style={[s.cardTitle, { color: colors.ink }]} accessibilityRole="header">
          {title}
        </Text>
        {aside}
      </View>
      {children}
    </View>
  );
}

export function Muted({ colors, children }: { colors: Colors; children: ReactNode }) {
  return <Text style={[s.muted, { color: colors.muted }]}>{children}</Text>;
}

/** A row with a round check on the left, as in Today and the list. */
export function CheckRow({
  label,
  done,
  onPress,
  colors,
  detail,
}: {
  label: string;
  done: boolean;
  onPress(): void;
  colors: Colors;
  detail?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={s.row}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={label}
      hitSlop={6}
    >
      <View
        style={[
          s.check,
          { borderColor: colors.ink, backgroundColor: done ? colors.ink : 'transparent' },
        ]}
      />
      <View style={s.rowText}>
        <Text style={[s.rowLabel, { color: colors.ink }, done && s.done]}>{label}</Text>
        {detail ? <Text style={[s.small, { color: colors.muted }]}>{detail}</Text> : null}
      </View>
    </Pressable>
  );
}

/** A text field with a round button, for adding a task, a goal or something to remember. */
export function AddField({
  placeholder,
  onAdd,
  colors,
}: {
  placeholder: string;
  onAdd(text: string): void;
  colors: Colors;
}) {
  const value = useRef('');
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const submit = () => {
    const clean = value.current.trim();
    if (!clean) return;
    onAdd(clean);
    input.current?.clear();
    value.current = '';
  };
  return (
    <View style={[s.add, { borderColor: colors.lineMid }]}>
      <TextInput
        ref={input}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        onChangeText={(t) => {
          value.current = t;
        }}
        onSubmitEditing={submit}
        returnKeyType="done"
        style={[s.addInput, { color: colors.ink }]}
        accessibilityLabel={placeholder}
      />
      <RoundButton label="Add" glyph="+" onPress={submit} colors={colors} />
    </View>
  );
}

export function RoundButton({
  label,
  glyph,
  onPress,
  colors,
  disabled,
}: {
  label: string;
  glyph: string;
  onPress(): void;
  colors: Colors;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[s.round, { backgroundColor: colors.ink, opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={[s.roundGlyph, { color: colors.onInk }]}>{glyph}</Text>
    </Pressable>
  );
}

export function TextButton({
  label,
  onPress,
  colors,
}: {
  label: string;
  onPress(): void;
  colors: Colors;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
      <Text style={[s.textButton, { color: colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 20, padding: 18, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  cardTitle: { fontFamily: SERIF, fontSize: 26, fontWeight: '500' },
  muted: { fontFamily: SERIF, fontSize: 16, fontStyle: 'italic' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
  rowText: { flex: 1 },
  rowLabel: { fontFamily: SERIF, fontSize: 19 },
  done: { textDecorationLine: 'line-through', opacity: 0.55 },
  small: { fontFamily: SERIF, fontSize: 14 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, paddingTop: 10 },
  addInput: { flex: 1, fontFamily: SERIF, fontSize: 18, minHeight: 44 },
  round: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundGlyph: { fontSize: 22, lineHeight: 26 },
  textButton: { fontFamily: SERIF, fontSize: 16, textDecorationLine: 'underline' },
});
