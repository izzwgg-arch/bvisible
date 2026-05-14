import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { apiJson, saveTokens } from '../lib/api';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      const data = await apiJson<{
        accessToken: string;
        refreshToken: string;
      }>('/api/v1/auth/login', {
        method: 'POST',
        skipAuth: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          deviceLabel: deviceLabel.trim() || undefined,
        }),
      });
      await saveTokens(data.accessToken, data.refreshToken);
      router.replace('/purchase-orders');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>B Visible</Text>
        <Text style={styles.sub}>Field uploads — sign in with your tenant account.</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
          placeholder="you@company.com"
          placeholderTextColor="#94a3b8"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••••••"
          placeholderTextColor="#94a3b8"
        />

        <Text style={styles.label}>Device label (optional)</Text>
        <TextInput
          style={styles.input}
          value={deviceLabel}
          onChangeText={setDeviceLabel}
          placeholder="e.g. Lead installer phone"
          placeholderTextColor="#94a3b8"
        />

        {error ? <Text style={styles.err}>{error}</Text> : null}

        <Pressable
          style={[styles.btn, busy && styles.btnDisabled]}
          onPress={onSubmit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Continue</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f1f5f9', justifyContent: 'center', padding: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 22,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a', marginBottom: 6 },
  sub: { fontSize: 14, color: '#64748b', marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 14,
    backgroundColor: '#f8fafc',
  },
  err: { color: '#b91c1c', fontSize: 13, marginBottom: 10 },
  btn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
