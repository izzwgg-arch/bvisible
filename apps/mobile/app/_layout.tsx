import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
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
  );
}
