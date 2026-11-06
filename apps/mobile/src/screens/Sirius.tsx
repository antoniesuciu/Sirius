import { type LiveState, useClient, useConversation } from '@sirius/client';
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Logo } from '../Logo.tsx';
import type { Colors } from '../theme.ts';
import { RoundButton, TextButton } from '../ui.tsx';

interface Line {
  id: string;
  mine: boolean;
  text: string;
}

export function Sirius({ colors, live }: { colors: Colors; live: LiveState }) {
  const client = useClient();
  const conversation = useConversation().data;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const stored: Line[] = (conversation?.messages ?? [])
    .filter((m) => m.role !== 'tool')
    .map((m) => ({ id: m.id, mine: m.role === 'user', text: m.text }));

  // A finished reply stays until its stored copy arrives a round trip later: no blink.
  const [held, setHeld] = useState<{ text: string; count: number } | null>(null);
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (live.streaming !== null) last.current = live.streaming;
    else if (last.current) {
      setHeld({ text: last.current, count: stored.length });
      last.current = null;
    }
  }, [live.streaming, stored.length]);
  useEffect(() => {
    if (held && stored.length > held.count) setHeld(null);
  }, [held, stored.length]);

  const lines: Line[] = [
    ...stored,
    ...(pending && !stored.some((l) => l.mine && l.text === pending)
      ? [{ id: 'pending', mine: true, text: pending }]
      : []),
    ...(live.streaming !== null || held
      ? [{ id: 'live', mine: false, text: live.streaming ?? held?.text ?? '' }]
      : live.thinking
        ? [{ id: 'live', mine: false, text: '…' }]
        : []),
    ...(error ? [{ id: 'error', mine: false, text: error }] : []),
  ];

  const send = () => {
    const text = draft.trim();
    if (!text || live.turnId) return;
    setDraft('');
    setError(null);
    setPending(text);
    client.call('send_chat', { text }).catch(() => {
      setError("I can't reach the laptop just now. Is it awake and on Tailscale?");
    });
  };

  return (
    <View style={[s.card, { backgroundColor: colors.panel, borderColor: colors.panelBorder }]}>
      <View style={s.head}>
        <Logo size={40} colors={colors} />
        <View style={s.name}>
          <Text style={[s.title, { color: colors.ink }]}>Sirius</Text>
          <Text style={[s.status, { color: colors.muted }]}>
            {live.turnId ? (live.streaming ? 'speaking' : 'thinking') : 'ready'}
          </Text>
        </View>
        {!live.turnId && (
          <TextButton
            label="New chat"
            onPress={() => {
              setPending(null);
              setHeld(null);
              void client.call('new_conversation', {});
            }}
            colors={colors}
          />
        )}
      </View>
      <FlatList
        style={s.log}
        inverted
        data={[...lines].reverse()}
        keyExtractor={(l) => l.id}
        ListEmptyComponent={
          <Text style={[s.bubble, { color: colors.ink, backgroundColor: colors.bubbleSirius }]}>
            Ask me anything, or tell me what to add.
          </Text>
        }
        renderItem={({ item }) => (
          <Text
            style={[
              s.bubble,
              item.mine
                ? [s.mine, { backgroundColor: colors.ink, color: colors.onInk }]
                : { backgroundColor: colors.bubbleSirius, color: colors.ink },
            ]}
          >
            {item.text}
          </Text>
        )}
      />
      <View style={s.form}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          placeholder="Ask Sirius"
          placeholderTextColor={colors.placeholder}
          style={[
            s.input,
            { color: colors.ink, backgroundColor: colors.input, borderColor: colors.lineMid },
          ]}
          accessibilityLabel="Message Sirius"
          returnKeyType="send"
        />
        {live.turnId ? (
          <RoundButton
            label="Stop"
            glyph="■"
            onPress={() => void client.call('cancel_chat', { turn_id: live.turnId ?? '' })}
            colors={colors}
          />
        ) : (
          <RoundButton label="Send" glyph="↑" onPress={send} colors={colors} />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { flex: 1, borderWidth: 1, borderRadius: 20, padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { flex: 1 },
  title: { fontFamily: 'serif', fontSize: 24, fontWeight: '500' },
  status: { fontFamily: 'serif', fontSize: 15, fontStyle: 'italic' },
  log: { flex: 1 },
  bubble: {
    fontFamily: 'serif',
    fontSize: 18,
    lineHeight: 25,
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    marginVertical: 5,
    maxWidth: '92%',
    alignSelf: 'flex-start',
  },
  mine: { alignSelf: 'flex-end', borderBottomLeftRadius: 16, borderBottomRightRadius: 4 },
  form: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 23,
    paddingHorizontal: 18,
    fontFamily: 'serif',
    fontSize: 18,
  },
});
