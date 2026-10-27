import { MAX_IMAGE_ATTACHMENTS } from '@/lib/referencePolicy';
import { useReferenceDrop } from './useReferenceDrop';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Asset } from '@/types';
import { referenceFileAsset } from '@/lib/referenceMedia';
import { saveAssets } from '@/lib/storage';
import { useAppStore } from '@/store/appStore';

const NO_ATTACHMENTS: string[] = [];

export function useImageAttachments(
  sessionId: string,
  mode: 'studio' | 'chat',
  limit = MAX_IMAGE_ATTACHMENTS,
) {
  const currentIds = useAppStore((state) => {
    const draft = state.drafts[sessionId];
    if (!draft) return NO_ATTACHMENTS;
    return mode === 'studio' ? draft.studioAttachmentIds : draft.chatAttachmentIds;
  });
  const assets = useAppStore((state) => state.assets);
  const setDraftAttachments = useAppStore((state) => state.setDraftAttachments);
  const addToast = useAppStore((state) => state.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const readingRef = useRef(false);

  const attachments = useMemo(
    () => currentIds.map((id) => assets[id]).filter((asset): asset is Asset => Boolean(asset)),
    [assets, currentIds],
  );

  const pickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || !sessionId || readingRef.current) return;
      const state = useAppStore.getState();
      const draft = state.drafts[sessionId];
      const existing =
        (mode === 'studio' ? draft?.studioAttachmentIds : draft?.chatAttachmentIds) ?? [];
      if (existing.length + files.length > limit) {
        addToast(`最多同时参考 ${limit} 张图片，请减少选择的文件。`, 'error');
        return;
      }
      readingRef.current = true;
      setReading(true);
      try {
        const additions: Asset[] = [];
        for (const file of files)
          additions.push(await referenceFileAsset(file, sessionId, false, false));
        if (!useAppStore.getState().sessions.some((session) => session.id === sessionId)) return;
        await saveAssets(additions, true);
        const latestState = useAppStore.getState();
        if (!latestState.sessions.some((session) => session.id === sessionId)) return;
        const latest = latestState.drafts[sessionId];
        const ids =
          (mode === 'studio' ? latest?.studioAttachmentIds : latest?.chatAttachmentIds) ?? [];
        if (ids.length + additions.length > limit)
          throw new Error(`最多同时参考 ${limit} 张图片。`);
        useAppStore.setState((state) => ({
          assets: {
            ...state.assets,
            ...Object.fromEntries(additions.map((asset) => [asset.id, asset])),
          },
        }));
        setDraftAttachments(sessionId, mode, [...ids, ...additions.map((asset) => asset.id)]);
      } catch (error) {
        addToast(error instanceof Error ? error.message : '素材读取失败，请重试。', 'error');
      } finally {
        readingRef.current = false;
        setReading(false);
      }
    },
    [addToast, mode, sessionId, setDraftAttachments, limit],
  );

  const removeAttachment = useCallback(
    (assetId: string) => {
      const state = useAppStore.getState();
      const latest = state.drafts[sessionId];
      const ids =
        (mode === 'studio' ? latest?.studioAttachmentIds : latest?.chatAttachmentIds) ?? [];
      setDraftAttachments(
        sessionId,
        mode,
        ids.filter((id) => id !== assetId),
      );
    },
    [mode, sessionId, setDraftAttachments],
  );

  const addAttachment = (assetId: string) => {
    const state = useAppStore.getState();
    const asset = state.assets[assetId];
    if (
      !asset ||
      !asset.mimeType.startsWith('image/') ||
      !asset.dataUrl.startsWith('data:image/')
    ) {
      addToast('请选择已上传的图片；外部图片链接请先保存并上传。', 'error');
      return;
    }
    const draft = state.drafts[sessionId];
    const ids = (mode === 'studio' ? draft?.studioAttachmentIds : draft?.chatAttachmentIds) ?? [];
    if (ids.includes(assetId)) return;
    if (ids.length >= limit) {
      addToast(`最多同时参考 ${limit} 张图片。`, 'error');
      return;
    }
    setDraftAttachments(sessionId, mode, [...ids, assetId]);
  };
  const { dragActive, dropHandlers } = useReferenceDrop(
    {
      onFiles: onFilesSelected,
      onAsset: addAttachment,
      onError: (message) => addToast(message, 'error'),
    },
    reading,
  );

  return {
    dragActive,
    dropHandlers,
    attachments,
    reading,
    maxAttachments: limit,
    fileInputRef,
    pickFiles,
    onFilesSelected,
    removeAttachment,
    addAttachment,
  };
}
