// A07 — Identification and Authentication Failures: no password hints, no auto-fill of
// previous failed passwords. Errors give no information about which field is wrong.
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { z } from 'zod';
import { useAuthStore } from '../../store/authStore';
import { ApiError } from '../../api/client';

const SAVED_EMAIL_KEY = 'login.savedEmail';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);

  useEffect(() => {
    SecureStore.getItemAsync(SAVED_EMAIL_KEY)
      .then((saved) => { if (saved) setEmail(saved); })
      .catch(() => {});
  }, []);

  async function handleLogin() {
    const validation = loginSchema.safeParse({ email, password });
    if (!validation.success) {
      Alert.alert('Invalid input', validation.error.errors[0]?.message ?? 'Check your details.');
      return;
    }

    setLoading(true);
    try {
      await login(validation.data.email, validation.data.password);
      await SecureStore.setItemAsync(SAVED_EMAIL_KEY, validation.data.email);
      router.replace('/(app)/home');
    } catch (err) {
      // A09 — Security Logging: login failures logged server-side; client only shows generic message.
      const isAuthError = err instanceof ApiError && err.status === 401;
      Alert.alert(
        'Sign in failed',
        isAuthError ? 'Incorrect email or password.' : 'Something went wrong. Try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Sign in</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          editable={!loading}
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          editable={!loading}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 32,
    textAlign: 'center',
    color: '#1a1a1a',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    fontSize: 16,
    color: '#1a1a1a',
    backgroundColor: '#f9fafb',
  },
  button: {
    backgroundColor: '#2d6a4f',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
