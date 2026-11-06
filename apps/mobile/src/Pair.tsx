import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { type Connection, normaliseAddress, pair } from './connection.ts';
import { Logo } from './Logo.tsx';
import type { Colors } from './theme.ts';

/** Once per phone: the laptop's address and the code `sirius pair` shows (ADR 0010). */
export function Pair({ colors, onPaired }: { colors: Colors; onPaired(c: Connection): void }) {
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onPaired(await pair(normaliseAddress(address), code));
    } catch (e) {
      setError(
        e instanceof Error && e.message !== 'Network request failed'
          ? e.message
          : "Can't reach that address. Is the laptop awake and on Tailscale?",
      );
    } finally {
      setBusy(false);
    }
  };
  const field = [
    s.field,
    { color: colors.ink, borderColor: colors.lineMid, backgroundColor: colors.input },
  ];
  return (
    <View style={s.wrap}>
      <Logo size={120} colors={colors} />
      <Text style={[s.title, { color: colors.ink }]}>Pair with your laptop</Text>
      <Text style={[s.help, { color: colors.muted }]}>
        On the laptop, run sirius pair. Type the address and the six-digit code it shows.
      </Text>
      <TextInput
        style={field}
        value={address}
        onChangeText={setAddress}
        placeholder="laptop.tail1234.ts.net"
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel="Laptop address"
      />
      <TextInput
        style={field}
        value={code}
        onChangeText={setCode}
        placeholder="123456"
        placeholderTextColor={colors.placeholder}
        keyboardType="number-pad"
        maxLength={6}
        accessibilityLabel="Pairing code"
      />
      {error && <Text style={[s.help, { color: colors.ink }]}>{error}</Text>}
      <Pressable
        style={[s.button, { backgroundColor: colors.ink, opacity: busy ? 0.6 : 1 }]}
        onPress={() => void submit()}
        disabled={busy || !address.trim() || (code.length < 6 && address.trim() !== 'fixtures')}
        accessibilityRole="button"
      >
        {busy ? (
          <ActivityIndicator color={colors.onInk} />
        ) : (
          <Text style={[s.buttonText, { color: colors.onInk }]}>Pair</Text>
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 24, gap: 14, justifyContent: 'center', alignItems: 'stretch' },
  title: { fontFamily: 'serif', fontSize: 30, textAlign: 'center', marginTop: 8 },
  help: { fontFamily: 'serif', fontSize: 16, textAlign: 'center', lineHeight: 22 },
  field: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 25,
    paddingHorizontal: 20,
    fontFamily: 'serif',
    fontSize: 18,
  },
  button: {
    minHeight: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonText: { fontFamily: 'serif', fontSize: 19 },
});
