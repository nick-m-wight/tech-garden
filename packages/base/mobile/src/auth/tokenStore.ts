// A01 — Broken Access Control, A02 — Cryptographic Failures
// Tokens stored in Android Keystore / iOS Secure Enclave via expo-secure-store.
// Raw tokens are never logged or stored in AsyncStorage.
import * as SecureStore from 'expo-secure-store';

const KEY_ACCESS_TOKEN = 'auth.accessToken';
const KEY_REFRESH_TOKEN = 'auth.refreshToken';

// WHEN_UNLOCKED_THIS_DEVICE_ONLY: non-exportable, requires device unlock.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_ACCESS_TOKEN, accessToken, OPTIONS),
    SecureStore.setItemAsync(KEY_REFRESH_TOKEN, refreshToken, OPTIONS),
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_ACCESS_TOKEN, OPTIONS);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_REFRESH_TOKEN, OPTIONS);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_ACCESS_TOKEN, OPTIONS),
    SecureStore.deleteItemAsync(KEY_REFRESH_TOKEN, OPTIONS),
  ]);
}
