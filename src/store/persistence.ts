import { useEffect } from 'react';
import { saveMeta, writeSecrets } from '@/lib/storage';
import { snapshotMeta, useAppStore } from './appStore';

const PERSISTED_STATE_KEYS = [
  'sessions',
  'presets',
  'models',
  'drafts',
  'activeSessionId',
  'activeView',
  'activeImageModelKey',
  'activeTextModelKey',
  'imageParams',
  'providerConfigs',
  'preferences',
] as const;

export function useAppPersistence(): void {
  const hydrated = useAppStore((state) => state.hydrated);

  useEffect(() => {
    if (!hydrated) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstDirtyAt = 0;
    let isDirty = false;

    const flush = () => {
      if (!isDirty) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      firstDirtyAt = 0;
      const state = useAppStore.getState();
      if (!state.hydrated) return;
      isDirty = false;
      void saveMeta(snapshotMeta(state));
    };

    const schedule = () => {
      isDirty = true;
      const now = Date.now();
      if (!firstDirtyAt) firstDirtyAt = now;
      if (timer) clearTimeout(timer);
      const elapsed = now - firstDirtyAt;
      const wait = elapsed > 6500 ? 0 : 700;
      timer = setTimeout(flush, wait);
    };

    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (!state.hydrated) return;
      const changed = PERSISTED_STATE_KEYS.some((key) => state[key] !== previous[key]);
      if (changed) schedule();
    });

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const handlePageHide = () => flush();

    schedule();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      flush();
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      writeSecrets(useAppStore.getState().providerConfigs);
    };
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.providerConfigs === previous.providerConfigs) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, 250);
    });
    const handlePageHide = () => save();
    window.addEventListener('pagehide', handlePageHide);
    save();
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
      save();
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [hydrated]);
}
