import { describe, expect, it } from 'vitest';
import { creationHistory } from '@/lib/creationHistory';
import { SEEDANCE_MODELS, emptyVideoDraft } from '@/providers/video-capabilities';
import type { Asset, VideoTask } from '@/types';
const image = (id: string, createdAt: number, sessionId = 'one'): Asset => ({
  id,
  createdAt,
  sessionId,
  source: 'generated',
  mimeType: 'image/png',
  dataUrl: 'data:image/png;base64,YQ==',
});
const task = (
  id: string,
  createdAt: number,
  status: VideoTask['status'] = 'running',
): VideoTask => ({
  id,
  createdAt,
  updatedAt: createdAt,
  sessionId: 'one',
  providerId: 'volcengine',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: SEEDANCE_MODELS[0],
  draft: emptyVideoDraft(),
  status,
  paused: false,
});
describe('shared creation history', () => {
  it('interleaves images and video tasks in chronological order in the same session', () => {
    const assets = {
      first: image('first', 10),
      last: image('last', 30),
      foreign: image('foreign', 5, 'two'),
      upload: { ...image('upload', 15), source: 'upload' as const },
    };
    const tasks = { middle: task('middle', 20), failed: task('failed', 40, 'failed') };
    const history = creationHistory(assets, tasks, 'one');
    expect(history.map((entry) => entry.id)).toEqual([
      'first',
      'video-middle',
      'last',
      'video-failed',
    ]);
    expect(history.map((entry) => entry.kind)).toEqual(['image', 'video', 'image', 'video']);
  });
  it('keeps one stable history item when a running task becomes a saved video asset', () => {
    const running = task('clip', 10);
    const before = creationHistory({}, { clip: running }, 'one');
    const result = { url: 'https://example.test/clip.mp4' };
    const saved = { ...image('video-clip', 10), mimeType: 'video/mp4', dataUrl: '', video: result };
    const after = creationHistory(
      { 'video-clip': saved },
      { clip: { ...running, status: 'succeeded', result, assetSaved: true } },
      'one',
    );
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0]).toMatchObject({ asset: saved, task: { status: 'succeeded' } });
  });
  it('hides deleted saved results after reload while retaining unsaved results for recovery', () => {
    const completed = {
      ...task('deleted', 1, 'succeeded'),
      result: { url: 'https://example.test/deleted.mp4' },
      assetSaved: true,
    };
    const unsaved = {
      ...task('retry', 2, 'succeeded'),
      result: { url: 'https://example.test/retry.mp4' },
      assetSaved: false,
    };
    const tasks: Record<string, VideoTask> = JSON.parse(
      JSON.stringify({ deleted: completed, retry: unsaved }),
    );
    expect(creationHistory({}, tasks, 'one')).toEqual([
      { id: 'video-retry', kind: 'video', createdAt: 2, task: unsaved, asset: undefined },
    ]);
  });
  it('still shows a saved video without its original task, including older imported records', () => {
    const saved = {
      ...image('video-old', 1),
      video: { url: 'https://example.test/video.mp4' },
      mimeType: 'video/mp4',
      dataUrl: '',
    };
    expect(creationHistory({ 'video-old': saved }, {}, 'one')).toEqual([
      { id: 'video-old', kind: 'video', createdAt: 1, asset: saved },
    ]);
    expect(creationHistory({ 'video-old': saved }, {}, 'two')).toEqual([]);
  });
});
