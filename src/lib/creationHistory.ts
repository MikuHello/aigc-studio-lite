import type { Asset, VideoTask } from '@/types';

export type CreationHistoryEntry =
  | { id: string; kind: 'image'; createdAt: number; asset: Asset }
  | { id: string; kind: 'video'; createdAt: number; asset?: Asset; task?: VideoTask };

export function creationHistory(
  assets: Record<string, Asset>,
  tasks: Record<string, VideoTask>,
  sessionId: string,
): CreationHistoryEntry[] {
  const entries = new Map<string, CreationHistoryEntry>();
  for (const asset of Object.values(assets)) {
    if (asset.sessionId !== sessionId || asset.source !== 'generated') continue;
    entries.set(asset.id, {
      id: asset.id,
      kind: asset.video ? 'video' : 'image',
      createdAt: asset.createdAt,
      asset,
    });
  }
  for (const task of Object.values(tasks)) {
    if (task.sessionId !== sessionId) continue;
    const id = `video-${task.id}`;
    if (task.assetSaved && !assets[id]) continue;
    entries.set(id, { id, kind: 'video', createdAt: task.createdAt, task, asset: assets[id] });
  }
  return [...entries.values()].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}
