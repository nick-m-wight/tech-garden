import { Redirect } from 'expo-router';
import { useAuthStore } from '../store/authStore';

export default function Index() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? (
    <Redirect href="/(app)/home" />
  ) : (
    <Redirect href="/(auth)/login" />
  );
}
