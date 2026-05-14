import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import type { UploadQueueJob } from './types';
import { loadUploadQueue } from './storage';
import {
  drainUploadQueue,
  enqueuePreparedUpload as enqueuePreparedProcessor,
  retryUploadJob,
  forgetUploadJob,
  pruneCompletedJobs,
} from './processor';

interface UploadQueueContextValue {
  jobs: UploadQueueJob[];
  refresh: () => Promise<void>;
  enqueuePreparedUpload: typeof enqueuePreparedProcessor;
  retryJob: (id: string) => Promise<void>;
  removeJob: (id: string) => Promise<void>;
}

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null);

export function UploadQueueProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [jobs, setJobs] = useState<UploadQueueJob[]>([]);

  const refresh = useCallback(async () => {
    setJobs(await loadUploadQueue());
  }, []);

  useEffect(() => {
    void refresh();
    void drainUploadQueue();
    void pruneCompletedJobs();

    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
        void drainUploadQueue();
      }
    });

    const netUnsub = NetInfo.addEventListener(() => {
      void drainUploadQueue();
      void refresh();
    });

    const interval = setInterval(() => {
      void drainUploadQueue();
      void refresh();
    }, 22_000);

    return () => {
      appSub.remove();
      netUnsub();
      clearInterval(interval);
    };
  }, [refresh]);

  const value = useMemo<UploadQueueContextValue>(
    () => ({
      jobs,
      refresh,
      enqueuePreparedUpload: async (input) => {
        const id = await enqueuePreparedProcessor(input);
        await refresh();
        return id;
      },
      retryJob: async (id) => {
        await retryUploadJob(id);
        await refresh();
      },
      removeJob: async (id) => {
        await forgetUploadJob(id);
        await refresh();
      },
    }),
    [jobs, refresh]
  );

  return (
    <UploadQueueContext.Provider value={value}>
      {children}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue(): UploadQueueContextValue {
  const ctx = useContext(UploadQueueContext);
  if (!ctx) {
    throw new Error('useUploadQueue must be used within UploadQueueProvider');
  }
  return ctx;
}
