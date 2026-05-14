import { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { apiJson, clearTokens } from '../lib/api';

type PoRow = {
  id: string;
  number: string;
  status: string;
  subtotalCents: number;
  updatedAt: string;
  vendor: { id: string; name: string } | null;
};

export default function PurchaseOrdersScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<PoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiJson<{ purchaseOrders: PoRow[] }>(
        '/api/v1/purchase-orders'
      );
      setRows(data.purchaseOrders);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load POs.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  async function signOut() {
    try {
      await apiJson('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      /* still clear local tokens */
    }
    await clearTokens();
    router.replace('/login');
  }

  if (loading && rows.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <Pressable onPress={signOut} style={styles.outlineBtn}>
          <Text style={styles.outlineBtnText}>Sign out</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.banner}>{error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push(`/purchase-order/${item.id}`)}
          >
            <Text style={styles.poNum}>{item.number}</Text>
            <Text style={styles.poMeta}>
              {item.vendor?.name ?? 'No vendor'} · {item.status}
            </Text>
            <Text style={styles.poDate}>{item.updatedAt.slice(0, 10)}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No purchase orders yet.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f1f5f9', paddingHorizontal: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' },
  toolbar: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 12 },
  outlineBtn: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  outlineBtnText: { fontSize: 13, fontWeight: '600', color: '#334155' },
  banner: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
    color: '#991b1b',
    marginBottom: 10,
  },
  row: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  poNum: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  poMeta: { fontSize: 13, color: '#64748b', marginTop: 4 },
  poDate: { fontSize: 12, color: '#94a3b8', marginTop: 6 },
  empty: { textAlign: 'center', color: '#64748b', marginTop: 40 },
});
