import { useRef, useState } from 'react';
import type { Asset, ModelDescriptor, ReferenceKind, VideoDraft } from '@/types';
import { useAppStore } from '@/store/appStore';
import { saveAssets } from '@/lib/storage';
import { createId } from '@/lib/id';
import {
  assertImageDimensions,
  assetVideoReference,
  isReferenceUrl,
  readMediaMetadata,
  referenceFileAsset,
  referenceKind,
  referenceSource,
} from '@/lib/referenceMedia';
import {
  remapVideoReferences,
  validateReferenceMedia,
  validateVideoImageBudget,
} from '@/lib/video';
import { useReferenceDrop } from './useReferenceDrop';

export type ReferenceSlot = 'references' | 'firstFrameId' | 'lastFrameId';

export function useVideoReferences(
  sessionId: string,
  draft: VideoDraft,
  model: ModelDescriptor | undefined,
  prompt: () => string,
  report: (error: unknown) => void,
) {
  const [reading, setReading] = useState(false);
  const [choosing, setChoosing] = useState<ReferenceSlot | null>(null);
  const lock = useRef(false);
  const assets = useAppStore((state) => state.assets);
  const current = () => {
    const state = useAppStore.getState();
    const latest = state.drafts[sessionId]?.video ?? draft;
    const selectedModel = state.models.find((item) => item.key === latest.modelKey) ?? model;
    return { state, latest, caps: selectedModel?.capabilities.video };
  };
  const setReferences = (ids: string[]) => {
    const { state, latest } = current();
    const previous = latest.referenceIds ?? [];
    report(null);
    state.setVideoDraft(sessionId, {
      referenceIds: ids,
      prompt: remapVideoReferences(prompt(), previous, ids, state.assets),
    });
  };
  const validateSelection = (selected: Asset[]) => {
    const { caps, latest } = current();
    if (!caps) throw new Error('请先选择支持全能参考的视频模型。');
    validateReferenceMedia(caps, selected.map(assetVideoReference), false);
    validateVideoImageBudget(selected.map(referenceSource), latest.prompt);
  };
  const enrich = async (asset: Asset): Promise<Asset> => {
    const kind = referenceKind(asset);
    const source = referenceSource(asset);
    if (source.startsWith('asset://')) return asset;
    const media = asset.media ?? (await readMediaMetadata(source, kind));
    if (kind === 'image') assertImageDimensions(media);
    return { ...asset, media };
  };
  const commit = async (additions: Asset[], slot: ReferenceSlot, activateReference = false) => {
    const { state, latest } = current();
    if (!state.sessions.some((session) => session.id === sessionId)) return;
    const ids = latest.referenceIds ?? [];
    const next = [...new Set([...ids, ...additions.map((asset) => asset.id)])];
    const combined = {
      ...state.assets,
      ...Object.fromEntries(additions.map((asset) => [asset.id, asset])),
    };
    if (slot === 'references') validateSelection(next.map((id) => combined[id]).filter(Boolean));
    else if (additions.length !== 1 || referenceKind(additions[0]) !== 'image')
      throw new Error('首帧或尾帧一次只能添加一张图片；多素材请切换全能参考。');
    await saveAssets(additions, true);
    const fresh = current();
    if (!fresh.state.sessions.some((session) => session.id === sessionId)) return;
    const freshIds = [
      ...new Set([...(fresh.latest.referenceIds ?? []), ...additions.map((asset) => asset.id)]),
    ];
    if (slot === 'references')
      validateSelection(freshIds.map((id) => combined[id]).filter(Boolean));
    useAppStore.setState((state) => ({
      assets: {
        ...state.assets,
        ...Object.fromEntries(additions.map((asset) => [asset.id, asset])),
      },
    }));
    fresh.state.setVideoDraft(
      sessionId,
      slot === 'references'
        ? {
            referenceIds: freshIds,
            ...(activateReference && fresh.latest.params.mode === 'text'
              ? { params: { ...fresh.latest.params, mode: 'reference' as const } }
              : {}),
          }
        : { [slot]: additions[0].id },
    );
  };
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setReading(true);
    report(null);
    try {
      await work();
    } catch (error) {
      report(error);
      throw error;
    } finally {
      lock.current = false;
      setReading(false);
    }
  };
  const autoSlot = (): ReferenceSlot => {
    const { latest } = current();
    if (latest.params.mode === 'first-frame') return 'firstFrameId';
    if (latest.params.mode === 'first-last-frame')
      return latest.firstFrameId ? 'lastFrameId' : 'firstFrameId';
    return 'references';
  };
  const upload = async (files: File[], target?: ReferenceSlot) => {
    if (!files.length || lock.current) return;
    const activateReference = !target && current().latest.params.mode === 'text';
    const slot = target ?? autoSlot();
    await run(async () => {
      const additions: Asset[] = [];
      for (const file of files) {
        additions.push(await referenceFileAsset(file, sessionId, slot === 'references'));
        if (slot === 'references') {
          const { state, latest } = current();
          validateSelection([
            ...(latest.referenceIds ?? []).map((id) => state.assets[id]).filter(Boolean),
            ...additions,
          ]);
        }
      }
      await commit(additions, slot, activateReference);
    }).catch(() => {});
  };
  const select = (asset: Asset, target?: ReferenceSlot, toggle = false) => {
    if (lock.current) return;
    const activateReference = !target && current().latest.params.mode === 'text';
    const slot = target ?? autoSlot();
    const ids = current().latest.referenceIds ?? [];
    if (slot === 'references' && ids.includes(asset.id)) {
      if (toggle) setReferences(ids.filter((id) => id !== asset.id));
      else if (activateReference) {
        const { state, latest } = current();
        state.setVideoDraft(sessionId, { params: { ...latest.params, mode: 'reference' } });
      }
      return;
    }
    void run(async () => {
      await commit([await enrich(asset)], slot, activateReference);
      if (slot !== 'references') setChoosing(null);
    }).catch(() => {});
  };
  const addLink = async (url: string, kind: ReferenceKind, durationSeconds?: number) => {
    await run(async () => {
      if (!isReferenceUrl(url)) throw new Error('请输入 HTTPS 公网文件地址或 asset:// 素材 ID。');
      const media = url.startsWith('asset://')
        ? { durationSeconds }
        : await readMediaMetadata(url, kind);
      if (kind === 'image' && !url.startsWith('asset://')) assertImageDimensions(media);
      const mimeType =
        kind === 'video'
          ? /\.mov(?:[?#]|$)/i.test(url)
            ? 'video/quicktime'
            : 'video/mp4'
          : kind === 'audio'
            ? /\.wav(?:[?#]|$)/i.test(url)
              ? 'audio/wav'
              : 'audio/mpeg'
            : 'image/png';
      const asset: Asset = {
        id: createId('asset'),
        sessionId,
        source: 'upload',
        mimeType,
        dataUrl: url,
        media,
        filename: url.startsWith('asset://')
          ? url
          : decodeURIComponent(new URL(url).pathname.split('/').pop() || '链接素材'),
        createdAt: Date.now(),
      };
      if (kind === 'video') asset.video = { url, duration: media.durationSeconds };
      await commit([asset], 'references');
      const { state, latest } = current();
      state.setVideoDraft(sessionId, { params: { ...latest.params, mode: 'reference' } });
    });
  };
  const onLink = (url: string) => {
    void addLink(url, /\.(mp3|wav)(?:[?#]|$)/i.test(url) ? 'audio' : 'video').catch(() => {});
  };
  const { dragActive, dropHandlers } = useReferenceDrop(
    {
      onFiles: (files) => upload(files),
      onAsset: (id) => {
        if (assets[id]) select(assets[id]);
      },
      onLink,
      onError: (message) => report(new Error(message)),
    },
    reading,
  );
  return {
    reading,
    choosing,
    setChoosing,
    upload,
    select,
    addLink,
    onLink,
    setReferences,
    dragActive,
    dropHandlers,
    enrich,
  };
}
