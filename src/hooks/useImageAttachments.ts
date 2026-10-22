import { useDragReset } from './useDragReset';
import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import type { Asset } from '@/types';
import {
  fileToDataUrl,
  isSupportedImageFile,
  MAX_UPLOAD_BYTES,
  mimeFromFileName,
} from '@/lib/image';
import { createId } from '@/lib/id';
import { useAppStore } from '@/store/appStore';

const MAX_ATTACHMENTS = 6;
const NO_ATTACHMENTS: string[] = [];

export function useImageAttachments(sessionId: string, mode: 'studio' | 'chat') {
  const currentIds = useAppStore((state) => {
    const draft = state.drafts[sessionId];
    if (!draft) return NO_ATTACHMENTS;
    return mode === 'studio' ? draft.studioAttachmentIds : draft.chatAttachmentIds;
  });
  const assets = useAppStore((state) => state.assets);
  const addAssets = useAppStore((state) => state.addAssets);
  const setDraftAttachments = useAppStore((state) => state.setDraftAttachments);
  const deleteAsset = useAppStore((state) => state.deleteAsset);
  const addToast = useAppStore((state) => state.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  useDragReset(() => {
    dragDepth.current = 0;
    setDragActive(false);
  });
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
      const remaining = Math.max(0, MAX_ATTACHMENTS - existing.length);
      if (remaining === 0) {
        addToast(`最多同时参考 ${MAX_ATTACHMENTS} 张图片。`);
        return;
      }

      const accepted: File[] = [];
      for (const file of files) {
        if (!isSupportedImageFile(file) && !file.type.startsWith('image/')) {
          addToast(`${file.name} 不是支持的图片格式。`, 'error');
          continue;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          addToast(`${file.name} 超过 12 MB，已跳过。`, 'error');
          continue;
        }
        accepted.push(file);
        if (accepted.length >= remaining) break;
      }
      if (accepted.length === 0) return;

      readingRef.current = true;
      setReading(true);
      try {
        const created: Asset[] = [];
        for (const file of accepted) {
          try {
            const dataUrl = await fileToDataUrl(
              file.type ? file : new File([file], file.name, { type: mimeFromFileName(file.name) }),
            );
            created.push({
              id: createId('asset'),
              sessionId,
              source: 'upload',
              mimeType: file.type || mimeFromFileName(file.name),
              dataUrl,
              filename: file.name,
              createdAt: Date.now(),
            });
          } catch (error) {
            addToast(error instanceof Error ? error.message : '图片读取失败。', 'error');
          }
        }
        const latestState = useAppStore.getState();
        if (!latestState.sessions.some((session) => session.id === sessionId)) return;
        const latest = latestState.drafts[sessionId];
        const latestIds =
          (mode === 'studio' ? latest?.studioAttachmentIds : latest?.chatAttachmentIds) ?? [];
        const additions = created.slice(0, Math.max(0, MAX_ATTACHMENTS - latestIds.length));
        if (additions.length > 0) {
          addAssets(additions);
          setDraftAttachments(sessionId, mode, [
            ...latestIds,
            ...additions.map((asset) => asset.id),
          ]);
        }
        if (additions.length < files.length) {
          addToast(`已添加 ${additions.length} 张参考图，其余文件被跳过。`);
        }
      } finally {
        readingRef.current = false;
        setReading(false);
      }
    },
    [addAssets, addToast, mode, sessionId, setDraftAttachments],
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
      if (state.assets[assetId]?.source === 'upload') {
        void deleteAsset(assetId).catch((error: unknown) => {
          addToast(
            `参考图已移除，本地图片清理失败${error instanceof Error ? `：${error.message}` : '。'}`,
            'error',
          );
        });
      }
    },
    [addToast, deleteAsset, mode, sessionId, setDraftAttachments],
  );

  const dropHandlers = {
    onDragEnterCapture(event: DragEvent) {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragActive(true);
    },
    onDragOverCapture(event: DragEvent) {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeaveCapture() {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragActive(false);
    },
    onDropCapture(event: DragEvent) {
      dragDepth.current = 0;
      setDragActive(false);
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.stopPropagation();
      void onFilesSelected(Array.from(event.dataTransfer.files));
    },
  };

  return {
    dragActive,
    dropHandlers,
    attachments,
    reading,
    maxAttachments: MAX_ATTACHMENTS,
    fileInputRef,
    pickFiles,
    onFilesSelected,
    removeAttachment,
  };
}
