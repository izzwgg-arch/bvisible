import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UploadQueueJob } from './types';

const QUEUE_KEY = 'bv_mobile_upload_queue_v1';
const MAX_JOBS = 45;

function sortJobs(jobs: UploadQueueJob[]): UploadQueueJob[] {
  return [...jobs].sort((a, b) => a.createdAt - b.createdAt);
}

export async function loadUploadQueue(): Promise<UploadQueueJob[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UploadQueueJob[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveUploadQueue(jobs: UploadQueueJob[]): Promise<void> {
  const trimmed = sortJobs(jobs).slice(-MAX_JOBS);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
}

export async function updateJob(
  id: string,
  patch: Partial<UploadQueueJob>
): Promise<UploadQueueJob[]> {
  const jobs = await loadUploadQueue();
  const next = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
  await saveUploadQueue(next);
  return next;
}

export async function removeJob(id: string): Promise<UploadQueueJob[]> {
  const jobs = await loadUploadQueue();
  const next = jobs.filter((j) => j.id !== id);
  await saveUploadQueue(next);
  return next;
}

export async function upsertJob(job: UploadQueueJob): Promise<UploadQueueJob[]> {
  const jobs = await loadUploadQueue();
  const idx = jobs.findIndex((j) => j.id === job.id);
  let next: UploadQueueJob[];
  if (idx >= 0) {
    next = [...jobs];
    next[idx] = job;
  } else {
    next = [...jobs, job];
  }
  await saveUploadQueue(next);
  return next;
}
