import { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { apiJson } from '../../lib/api';
import { useUploadQueue } from '../../lib/upload-queue/context';
import { prepareUploadFile } from '../../lib/upload-queue/prepare-file';
import {
  UploadQueuePanel,
  UploadQueueSpinner,
} from '../../components/UploadQueuePanel';

type MobileAttachmentKind =
  | 'RECEIPT'
  | 'INSTALL_PHOTO'
  | 'FIELD_DOCUMENT'
  | 'VENDOR_INVOICE';

interface DetailResponse {
  purchaseOrder: {
    id: string;
    number: string;
    status: string;
    subtotalCents: number;
    notes: string;
    vendor: { id: string; name: string } | null;
    attachments: {
      id: string;
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
      kind: string;
      createdAt: string;
    }[];
    events: {
      id: string;
      kind: string;
      message: string;
      createdAt: string;
    }[];
  };
}

const UPLOAD_KINDS: { kind: MobileAttachmentKind; label: string }[] = [
  { kind: 'RECEIPT', label: 'Receipt' },
  { kind: 'INSTALL_PHOTO', label: 'Install photo' },
  { kind: 'FIELD_DOCUMENT', label: 'Field document' },
  { kind: 'VENDOR_INVOICE', label: 'Vendor invoice' },
];

export default function PurchaseOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const poId = typeof id === 'string' ? id : '';
  const [detail, setDetail] = useState<DetailResponse['purchaseOrder'] | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [pickingKind, setPickingKind] = useState<MobileAttachmentKind | null>(
    null
  );

  const { enqueuePreparedUpload, refresh: refreshQueue } = useUploadQueue();

  const load = useCallback(async () => {
    if (!poId) return;
    setError(null);
    try {
      const data = await apiJson<DetailResponse>(
        `/api/v1/purchase-orders/${poId}`
      );
      setDetail(data.purchaseOrder);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load PO.');
      setDetail(null);
    }
  }, [poId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void refreshQueue();
    }, [load, refreshQueue])
  );

  async function pickAndEnqueue(kind: MobileAttachmentKind) {
    if (!poId || pickingKind) return;
    setPickingKind(kind);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      });

      if (picked.canceled || !picked.assets?.length) {
        return;
      }

      const asset = picked.assets[0];
      let sizeBytes = asset.size ?? 0;
      if (!sizeBytes) {
        const info = await FileSystem.getInfoAsync(asset.uri, { size: true });
        sizeBytes =
          info.exists && typeof info.size === 'number' ? info.size : 0;
      }

      if (!sizeBytes) {
        Alert.alert(
          'Upload',
          'Could not determine file size. Pick another file.'
        );
        return;
      }

      const mimeType =
        asset.mimeType ??
        (asset.name?.toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : 'image/jpeg');

      const originalFilename =
        asset.name?.replace(/[/\\]/g, '') || 'attachment.bin';

      const prepared = await prepareUploadFile({
        localUri: asset.uri,
        mimeType,
        sizeBytes,
        originalFilename,
      });

      const poLabel = detail?.number ?? poId;

      await enqueuePreparedUpload({
        poId,
        poLabel,
        kind,
        localUri: prepared.uri,
        mimeType: prepared.mimeType,
        sizeBytes: prepared.sizeBytes,
        originalFilename: prepared.originalFilename,
      });

      Alert.alert(
        'Queued',
        'Upload runs in the background when you have a connection. Track progress below.'
      );

      void load();
    } catch (e) {
      Alert.alert(
        'Could not queue file',
        e instanceof Error ? e.message : 'Unknown error.'
      );
    } finally {
      setPickingKind(null);
    }
  }

  if (!detail && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={styles.screen}>
        <Text style={styles.err}>{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <UploadQueueSpinner />

      <View style={styles.hero}>
        <Text style={styles.po}>{detail.number}</Text>
        <Text style={styles.meta}>
          {detail.vendor?.name ?? 'Vendor'} · {detail.status}
        </Text>
      </View>

      <Text style={styles.section}>Attach file</Text>
      <View style={styles.grid}>
        {UPLOAD_KINDS.map(({ kind, label }) => (
          <Pressable
            key={kind}
            style={[
              styles.kindBtn,
              pickingKind === kind && styles.kindBtnBusy,
            ]}
            onPress={() => void pickAndEnqueue(kind)}
            disabled={pickingKind !== null}
          >
            {pickingKind === kind ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.kindBtnText}>{label}</Text>
            )}
          </Pressable>
        ))}
      </View>

      <UploadQueuePanel />

      <Text style={styles.section}>Attachments</Text>
      {detail.attachments.length === 0 ? (
        <Text style={styles.muted}>None yet.</Text>
      ) : (
        detail.attachments.map((a) => (
          <View key={a.id} style={styles.card}>
            <Text style={styles.cardTitle}>{a.originalFilename}</Text>
            <Text style={styles.muted}>
              {a.kind} · {a.mimeType} · {Math.round(a.sizeBytes / 1024)} KB
            </Text>
          </View>
        ))
      )}

      <Text style={styles.section}>Timeline</Text>
      {detail.events.slice(0, 20).map((ev) => (
        <View key={ev.id} style={styles.event}>
          <Text style={styles.eventMsg}>{ev.message}</Text>
          <Text style={styles.evMeta}>
            {ev.kind} · {ev.createdAt.slice(0, 16)}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f1f5f9', paddingHorizontal: 16 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
  },
  hero: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  po: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  meta: { fontSize: 14, color: '#64748b', marginTop: 6 },
  section: {
    marginTop: 22,
    marginBottom: 10,
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kindBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    minWidth: '47%',
    alignItems: 'center',
  },
  kindBtnBusy: { opacity: 0.85 },
  kindBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  muted: { fontSize: 13, color: '#64748b', marginTop: 4 },
  event: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  eventMsg: { fontSize: 14, color: '#0f172a' },
  evMeta: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  err: { color: '#b91c1c', padding: 16 },
});
