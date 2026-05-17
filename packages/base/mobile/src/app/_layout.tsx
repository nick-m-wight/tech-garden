import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initDb } from '../store/db';
import { useAuthStore } from '../store/authStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
    },
  },
});

function AppInitializer({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    initDb();
    void initialize();
  }, [initialize]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInitializer>
        <Stack screenOptions={{ headerShown: false }} />
      </AppInitializer>
    </QueryClientProvider>
  );
}
