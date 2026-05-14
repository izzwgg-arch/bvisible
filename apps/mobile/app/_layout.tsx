import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { UploadQueueProvider } from '../lib/upload-queue/context';
import { setAuthFailureListener } from '../lib/auth-events';

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    setAuthFailureListener(() => {
      router.replace('/login');
    });
    return () => setAuthFailureListener(null);
  }, [router]);

  return (
    <UploadQueueProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#f8fafc' },
          headerTintColor: '#0f172a',
          headerTitleStyle: { fontWeight: '600', fontSize: 17 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: '#f1f5f9' },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: 'Sign in' }} />
        <Stack.Screen name="purchase-orders" options={{ title: 'Purchase orders' }} />
        <Stack.Screen name="purchase-order/[id]" options={{ title: 'Purchase order' }} />
      </Stack>
    </UploadQueueProvider>
  );
}
