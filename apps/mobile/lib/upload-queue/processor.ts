import NetInfo from '@react-native-community/netinfo';
import { getAccessToken } from '../session';
import { ApiError, apiJson, forceRefreshTokens } from '../api';
import type { UploadQueueJob } from './types';
import {
  loadUploadQueue,
  removeJob,
  saveUploadQueue,
  upsertJob,
} from './storage';
import { computeBackoffMs, randomJitterMs } from './backoff';
import { putUriWithProgress } from './xhr-upload';

const PRESIGN_BUFFER_MS = 8000;

function parseUnauthorized(msg: string): boolean {
  return (
    msg.includes('401') ||
    msg.includes('session_invalid') ||
    msg.includes('invalid_token')
  );
}

async function presign(args: {
  purchaseOrderId: string;
  kind: UploadQueueJob['kind'];
  originalFilename: string;
  declaredSizeBytes: number;
}) {
  return apiJson<{
    uploadId: string;
    uploadUrl: string;
    expiresAt: string;
    declaredSizeBytes: number;
  }>('/api/v1/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purchaseOrderId: args.purchaseOrderId,
      kind: args.kind,
      originalFilename: args.originalFilename,
      declaredSizeBytes: args.declaredSizeBytes,
    }),
  });
}

async function complete(uploadId: string) {
  return apiJson<{
    attachmentId: string;
    idempotentReplay?: boolean;
  }>('/api/v1/uploads/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });
}

let drainMutex = false;

export async function drainUploadQueue(): Promise<void> {
  if (drainMutex) return;
  drainMutex = true;

  try {
    const net = await NetInfo.fetch();
    const online =
      net.isConnected === true &&
      (net.isInternetReachable === true || net.isInternetReachable === null);
    if (!online) return;

    const jobs = await loadUploadQueue();
    const now = Date.now();

    const pending = jobs.filter(
      (j) =>
        j.status !== 'completed' &&
        j.nextAttemptAt <= now
    );

    for (const job of pending) {
      const freshNet = await NetInfo.fetch();
      const stillOnline =
        freshNet.isConnected === true &&
        (freshNet.isInternetReachable === true ||
          freshNet.isInternetReachable === null);
      if (!stillOnline) break;

      await processJob(job);
    }
  } finally {
    drainMutex = false;
  }
}

async function processJob(job: UploadQueueJob): Promise<void> {
  let working = { ...job, status: 'uploading' as const, progress: 0 };
  await upsertJob(working);

  try {
    const token0 = await getAccessToken();
    if (!token0) {
      throw new Error('Not signed in.');
    }

    const needsPresign =
      !working.uploadId ||
      !working.uploadUrl ||
      !working.presignExpiresAtMs ||
      Date.now() > working.presignExpiresAtMs - PRESIGN_BUFFER_MS;

    if (needsPresign) {
      const p = await presign({
        purchaseOrderId: working.poId,
        kind: working.kind,
        originalFilename: working.originalFilename,
        declaredSizeBytes: working.sizeBytes,
      });
      working = {
        ...working,
        uploadId: p.uploadId,
        uploadUrl: p.uploadUrl,
        declaredSizeBytes: p.declaredSizeBytes,
        presignExpiresAtMs: Date.parse(p.expiresAt),
      };
      await upsertJob(working);
    }

    const putOnce = async () => {
      let bearer = await getAccessToken();
      if (!bearer) throw new Error('Not signed in.');
    let lastWritten = -1;
    await putUriWithProgress({
      uri: working.localUri,
      url: working.uploadUrl!,
      authorizationBearer: bearer,
      onProgress: async (pct) => {
        working = { ...working, progress: pct };
        const shouldPersist =
          pct >= 100 || lastWritten < 0 || pct - lastWritten >= 5;
        if (shouldPersist) {
          lastWritten = pct;
          await upsertJob({ ...working, progress: pct });
        }
      },
    });
    };

    try {
      await putOnce();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('401') || msg.includes('403')) {
        const ok = await forceRefreshTokens();
        if (!ok) throw e;
        await putOnce();
      } else {
        throw e;
      }
    }

    await complete(working.uploadId!);

    working = {
      ...working,
      status: 'completed',
      progress: 100,
      lastError: undefined,
    };
    await upsertJob(working);
    await removeJob(working.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upload failed';
    const retry = working.retryCount + 1;
    const delay = computeBackoffMs(retry, randomJitterMs());
    working = {
      ...working,
      status: 'failed',
      retryCount: retry,
      nextAttemptAt: Date.now() + delay,
      lastError: msg,
      progress: 0,
    };
    await upsertJob(working);
  }
}

function newLocalJobId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export async function enqueuePreparedUpload(input: {
  jobId?: string;
  poId: string;
  poLabel?: string;
  kind: UploadQueueJob['kind'];
  localUri: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
}): Promise<string> {
  const id = input.jobId ?? newLocalJobId();
  const job: UploadQueueJob = {
    id,
    poId: input.poId,
    poLabel: input.poLabel,
    kind: input.kind,
    localUri: input.localUri,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    originalFilename: input.originalFilename,
    createdAt: Date.now(),
    retryCount: 0,
    nextAttemptAt: 0,
    status: 'queued',
    progress: 0,
  };
  await upsertJob(job);
  void drainUploadQueue();
  return id;
}

export async function retryUploadJob(id: string): Promise<void> {
  const jobs = await loadUploadQueue();
  const j = jobs.find((x) => x.id === id);
  if (!j) return;
  await upsertJob({
    ...j,
    status: 'queued',
    nextAttemptAt: 0,
    lastError: undefined,
    progress: 0,
  });
  void drainUploadQueue();
}

export async function forgetUploadJob(id: string): Promise<void> {
  await removeJob(id);
}

/** Drop stale completed rows if any slipped through (should not happen). */
export async function pruneCompletedJobs(): Promise<void> {
  const jobs = await loadUploadQueue();
  const active = jobs.filter((j) => j.status !== 'completed');
  await saveUploadQueue(active);
}

export function isUnauthorizedError(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 401) return true;
  if (!(err instanceof Error)) return false;
  return parseUnauthorized(err.message);
}
