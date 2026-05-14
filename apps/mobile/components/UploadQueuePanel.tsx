import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import type { UploadQueueJob } from '../lib/upload-queue/types';
import { useUploadQueue } from '../lib/upload-queue/context';

function statusLabel(j: UploadQueueJob): string {
  switch (j.status) {
    case 'queued':
      return j.retryCount > 0 ? 'Queued · will retry' : 'Queued';
    case 'uploading':
      return `Uploading ${j.progress}%`;
    case 'failed':
      return 'Needs attention';
    case 'completed':
      return 'Done';
    default:
      return '';
  }
}

export function UploadQueuePanel() {
  const { jobs, retryJob, removeJob } = useUploadQueue();
  const active = jobs.filter((j) => j.status !== 'completed');
  if (active.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Upload queue</Text>
      <Text style={styles.sub}>
        Finishes automatically when you have signal. Safe to leave the screen.
      </Text>
      {active.map((j) => (
        <View key={j.id} style={styles.row}>
            <View style={styles.rowTop}>
              <Text style={styles.filename} numberOfLines={1}>
                {j.originalFilename}
              </Text>
              <Text style={styles.badge}>{statusLabel(j)}</Text>
            </View>
            <Text style={styles.meta} numberOfLines={1}>
              {j.poLabel ?? j.poId} · {j.kind}
            </Text>
            {j.status === 'uploading' ? (
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.max(4, j.progress)}%` }]} />
              </View>
            ) : null}
            {j.lastError ? (
              <Text style={styles.err} numberOfLines={3}>
                {j.lastError}
              </Text>
            ) : null}
            <View style={styles.actions}>
              {j.status === 'failed' ? (
                <Pressable style={styles.primaryBtn} onPress={() => void retryJob(j.id)}>
                  <Text style={styles.primaryTxt}>Retry now</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.secondaryBtn} onPress={() => void removeJob(j.id)}>
                <Text style={styles.secondaryTxt}>Dismiss</Text>
              </Pressable>
            </View>
        </View>
      ))}
    </View>
  );
}

export function UploadQueueSpinner() {
  const { jobs } = useUploadQueue();
  const busy = jobs.some((j) => j.status === 'uploading');
  if (!busy) return null;
  return (
    <View style={styles.inlineBusy}>
      <ActivityIndicator color="#2563eb" size="small" />
      <Text style={styles.inlineBusyTxt}>Uploading files…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 16,
    padding: 14,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    maxHeight: 320,
  },
  title: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  sub: { fontSize: 12, color: '#64748b', marginTop: 4, marginBottom: 10 },
  row: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
  },
  filename: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0f172a' },
  badge: { fontSize: 11, fontWeight: '700', color: '#2563eb' },
  meta: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  track: {
    height: 8,
    borderRadius: 6,
    backgroundColor: '#e2e8f0',
    marginTop: 10,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#2563eb',
  },
  err: { fontSize: 12, color: '#b91c1c', marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  primaryBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  primaryTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
  },
  secondaryTxt: { color: '#475569', fontWeight: '600', fontSize: 13 },
  inlineBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  inlineBusyTxt: { fontSize: 13, fontWeight: '600', color: '#1e40af' },
});
