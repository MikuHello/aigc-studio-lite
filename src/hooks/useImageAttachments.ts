import { failureNotice } from '@/lib/notices';
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
  const [feedback, setFeedback] = useState<{
    sessionId: string;
    mode: string;
    message: string;
  } | null>(null);
  const reportError = useCallback(
    (message: string | null) => setFeedback(message ? { sessionId, mode, message } : null),
    [sessionId, mode],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const readingRef = useRef(false);

  const attachments = useMemo(
    () => currentIds.map((id) => assets[id]).filter((asset): asset is Asset => Boolean(asset)),
    [assets, currentIds],
  );

  const pickFiles = useCallback(() => {
    reportError(null);
    fileInputRef.current?.click();
  }, [reportError]);

  const onFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || !sessionId || readingRef.current) return;
      reportError(null);
      const state = useAppStore.getState();
      const draft = state.drafts[sessionId];
      const existing =
        (mode === 'studio' ? draft?.studioAttachmentIds : draft?.chatAttachmentIds) ?? [];
      if (existing.length + files.length > limit) {
        reportError(`最多同时参考 ${limit} 张图片，请减少选择的文件。`);
        return;
      }
      readingRef.current = true;
      setReading(true);
      try {
        const additions: Asset[] = [];
        for (const file of files)
          additions.push(await referenceFileAsset(file, sessionId, false, false));
        if (!useAppStore.getState().sessions.some((session) => session.id === sessionId)) return;
        try {
          await saveAssets(additions, true);
        } catch (error) {
          useAppStore.getState().notify(failureNotice('保存素材失败', error));
          return;
        }
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
        reportError(error instanceof Error ? error.message : '请检查素材格式后重试。');
      } finally {
        readingRef.current = false;
        setReading(false);
      }
    },
    [reportError, mode, sessionId, setDraftAttachments, limit],
  );

  const removeAttachment = useCallback(
    (assetId: string) => {
      reportError(null);
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
    [mode, sessionId, setDraftAttachments, reportError],
  );

  const addAttachment = (assetId: string) => {
    reportError(null);
    const state = useAppStore.getState();
    const asset = state.assets[assetId];
    if (
      !asset ||
      !asset.mimeType.startsWith('image/') ||
      !asset.dataUrl.startsWith('data:image/')
    ) {
      reportError('请选择已上传的图片，外部图片链接请先保存并上传。');
      return;
    }
    const draft = state.drafts[sessionId];
    const ids = (mode === 'studio' ? draft?.studioAttachmentIds : draft?.chatAttachmentIds) ?? [];
    if (ids.includes(assetId)) return;
    if (ids.length >= limit) {
      reportError(`最多同时参考 ${limit} 张图片。`);
      return;
    }
    setDraftAttachments(sessionId, mode, [...ids, assetId]);
  };
  const { dragActive, dropHandlers } = useReferenceDrop(
    {
      onFiles: onFilesSelected,
      onAsset: addAttachment,
      onError: reportError,
    },
    reading,
  );

  return {
    error: feedback?.sessionId === sessionId && feedback.mode === mode ? feedback.message : null,
    reportError,
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
