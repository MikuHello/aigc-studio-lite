import { videoStylePrompt } from '@/lib/videoStyles';
import { withVideoTiming } from '@/lib/videoTiming';
import { customModel } from '@/lib/customModels';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/store/appStore';
import {
  useVideoTasks,
  hydrateVideoTasks,
  submitVideo,
  refreshVideo,
  cancelVideo,
  recoverVideo,
  needsVideoQuery,
  pauseVideo,
} from '@/store/videoTasks';
import { SEEDANCE_MODELS, emptyVideoDraft } from '@/providers/video-capabilities';
import { adapters } from '@/providers';
import { ProviderError } from '@/providers/types';
import type { VideoTask } from '@/types';

const db = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), remove: vi.fn(), assets: vi.fn() }));
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  loadVideoTasks: db.load,
  saveVideoTask: db.save,
  removeVideoTask: db.remove,
  saveVideoResult: db.assets,
}));
const createVideo = vi.fn();
const queryVideo = vi.fn();
const cancelRemote = vi.fn();
const model = SEEDANCE_MODELS[0];
const draft = { ...emptyVideoDraft(), prompt: '镜头缓缓推进', modelKey: model.key };
const input = { prompt: draft.prompt, params: draft.params, references: [] };
const sessionId = 'video-test-session';
const task = (id = 'persisted'): VideoTask => ({
  id,
  remoteId: 'cgt-existing',
  sessionId,
  providerId: 'volcengine',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model,
  draft,
  status: 'running',
  paused: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

beforeEach(() => {
  vi.resetAllMocks();
  db.load.mockResolvedValue([]);
  db.save.mockResolvedValue(undefined);
  db.assets.mockResolvedValue(undefined);
  useAppStore.setState(useAppStore.getInitialState(), true);
  useVideoTasks.setState(useVideoTasks.getInitialState(), true);
  useAppStore.setState((state) => ({
    sessions: [{ id: sessionId, title: 'test', messages: [], createdAt: 1, updatedAt: 1 }],
    providerConfigs: {
      ...state.providerConfigs,
      volcengine: { apiKey: 'test-only', baseUrl: task().baseUrl, rememberKey: false },
    },
  }));
  adapters.volcengine.video = { createVideo, queryVideo, cancelVideo: cancelRemote };
});

describe('video task lifecycle', () => {
  it('queries a historical task through its original disabled supplier, not another supplier with the same model', async () => {
    const saved = {
      ...task(),
      connectionId: 'original',
      model: { ...model, connectionId: 'original', key: `original::${model.modelId}` },
    };
    useAppStore.setState((state) => ({
      providerConfigs: {
        ...state.providerConfigs,
        original: {
          providerId: 'volcengine',
          apiKey: 'original-test-key',
          baseUrl: saved.baseUrl,
          rememberKey: false,
          disabled: true,
        },
        replacement: {
          providerId: 'volcengine',
          apiKey: 'replacement-test-key',
          baseUrl: saved.baseUrl,
          rememberKey: false,
        },
      },
    }));
    db.load.mockResolvedValue([saved]);
    queryVideo.mockResolvedValue({ status: 'running' });
    await hydrateVideoTasks();
    await refreshVideo(saved.id);
    expect(queryVideo.mock.calls[0][0].apiKey).toBe('original-test-key');
    expect(queryVideo.mock.calls[0][1]).toBe(saved.remoteId);
    await expect(submitVideo(sessionId, saved.model, draft, input)).rejects.toThrow('停用');
    expect(createVideo).not.toHaveBeenCalled();
  });
  it('restores running tasks without resubmitting; interrupted submissions become uncertain', async () => {
    db.load.mockResolvedValue([
      task(),
      { ...task('interrupted'), status: 'submitting', remoteId: undefined },
    ]);
    await hydrateVideoTasks();
    queryVideo.mockResolvedValue({ status: 'running' });
    await refreshVideo('persisted');
    expect(queryVideo).toHaveBeenCalledTimes(1);
    expect(createVideo).not.toHaveBeenCalled();
    expect(useVideoTasks.getState().tasks.interrupted).toMatchObject({
      status: 'unknown',
      paused: true,
    });
  });
  it('persists the task before contacting the provider, de-duplicates concurrent submissions and never stores the key', async () => {
    await hydrateVideoTasks();
    let resolve!: (id: string) => void;
    createVideo.mockImplementation(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const first = submitVideo(sessionId, model, draft, input);
    await vi.waitFor(() => expect(createVideo).toHaveBeenCalledTimes(1));
    await submitVideo(sessionId, model, draft, input);
    expect(db.save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db.save.mock.calls)).not.toContain('test-only');
    resolve('cgt-created');
    await first;
    expect(Object.values(useVideoTasks.getState().tasks)[0]).toMatchObject({
      remoteId: 'cgt-created',
      status: 'queued',
    });
  });
  it('blocks paid submission when local persistence fails', async () => {
    await hydrateVideoTasks();
    db.save.mockRejectedValueOnce(new Error('disk full'));
    await expect(submitVideo(sessionId, model, draft, input)).rejects.toThrow('disk full');
    expect(createVideo).not.toHaveBeenCalled();
    expect(Object.values(useVideoTasks.getState().tasks)).toHaveLength(1);
    expect(Object.values(useVideoTasks.getState().tasks)[0].status).toBe('failed');
  });
  it('keeps a network submission timeout uncertain without creating another task', async () => {
    await hydrateVideoTasks();
    createVideo.mockRejectedValueOnce(new ProviderError('timeout', { kind: 'network' }));
    await submitVideo(sessionId, model, draft, input);
    expect(Object.values(useVideoTasks.getState().tasks)).toHaveLength(1);
    expect(Object.values(useVideoTasks.getState().tasks)[0]).toMatchObject({
      status: 'unknown',
      paused: true,
    });
    expect(createVideo).toHaveBeenCalledTimes(1);
  });
  it('cancels a queued remote task and persists its confirmed cancelled state', async () => {
    db.load.mockResolvedValue([{ ...task(), status: 'queued' }]);
    await hydrateVideoTasks();
    queryVideo
      .mockResolvedValueOnce({ status: 'queued' })
      .mockResolvedValueOnce({ status: 'cancelled' });
    await cancelVideo('persisted');
    expect(cancelRemote).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ apiKey: 'test-only' }),
      'cgt-existing',
      expect.any(Object),
    );
    expect(queryVideo).toHaveBeenCalledTimes(2);
    expect(queryVideo.mock.invocationCallOrder[0]).toBeLessThan(
      cancelRemote.mock.invocationCallOrder[0],
    );
    expect(cancelRemote.mock.invocationCallOrder[0]).toBeLessThan(
      queryVideo.mock.invocationCallOrder[1],
    );
    expect(db.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'cancelled', paused: true }),
    );
    expect(useVideoTasks.getState().tasks.persisted.status).toBe('cancelled');
  });
  it('does not claim cancellation when confirmation fails', async () => {
    db.load.mockResolvedValue([{ ...task(), status: 'queued' }]);
    await hydrateVideoTasks();
    queryVideo
      .mockResolvedValueOnce({ status: 'queued' })
      .mockRejectedValueOnce(new Error('offline'));
    await cancelVideo('persisted');
    expect(cancelRemote).toHaveBeenCalledOnce();
    expect(useVideoTasks.getState().tasks.persisted).toMatchObject({
      status: 'queued',
      paused: true,
      queryError: expect.stringContaining('确认'),
    });
  });
  it('binds a remote ID to an unknown submission and saves its recovered result without resubmitting', async () => {
    db.load.mockResolvedValue([
      { ...task(), status: 'unknown', remoteId: undefined, paused: true },
    ]);
    await hydrateVideoTasks();
    const result = { url: 'https://media.example/recovered.mp4' };
    queryVideo.mockResolvedValue({ status: 'succeeded', result });
    await recoverVideo('persisted', 'cgt-recovered');
    expect(queryVideo).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ apiKey: 'test-only' }),
      'cgt-recovered',
      expect.any(Object),
    );
    expect(createVideo).not.toHaveBeenCalled();
    expect(useVideoTasks.getState().tasks.persisted).toMatchObject({
      remoteId: 'cgt-recovered',
      status: 'succeeded',
      assetSaved: true,
      paused: false,
    });
    expect(db.assets).toHaveBeenCalledOnce();
    expect(useAppStore.getState().assets['video-persisted'].video).toEqual(result);
  });
  it('does not turn a polling error into generation failure; missing result is still queryable', async () => {
    db.load.mockResolvedValue([task()]);
    await hydrateVideoTasks();
    queryVideo.mockRejectedValueOnce(new Error('temporary network error'));
    await refreshVideo('persisted');
    expect(useVideoTasks.getState().tasks.persisted.status).toBe('running');
    queryVideo.mockResolvedValueOnce({ status: 'succeeded' });
    await refreshVideo('persisted');
    expect(needsVideoQuery(useVideoTasks.getState().tasks.persisted)).toBe(true);
    expect(db.assets).not.toHaveBeenCalled();
  });
  it('saves a completed video once and never recreates a deleted gallery asset', async () => {
    db.load.mockResolvedValue([task()]);
    await hydrateVideoTasks();
    queryVideo.mockResolvedValue({
      status: 'succeeded',
      result: { url: 'https://media.example/result.mp4' },
    });
    await refreshVideo('persisted');
    expect(db.assets).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().assets['video-persisted'].video?.url).toBe(
      'https://media.example/result.mp4',
    );
    useAppStore.setState({ assets: {} });
    await refreshVideo('persisted');
    expect(db.assets).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().assets).toEqual({});
  });
  it('never sends credentials to a changed endpoint and pauses blocked queries', async () => {
    db.load.mockResolvedValue([task()]);
    await hydrateVideoTasks();
    useAppStore
      .getState()
      .setProviderConfig('volcengine', { baseUrl: 'https://changed.example/v3' });
    await refreshVideo('persisted');
    expect(queryVideo).not.toHaveBeenCalled();
    expect(useVideoTasks.getState().tasks.persisted.paused).toBe(true);
  });
  it('checks remote status before cancelling so a completed record is saved instead of deleted', async () => {
    db.load.mockResolvedValue([{ ...task(), status: 'queued' }]);
    await hydrateVideoTasks();
    queryVideo.mockResolvedValue({
      status: 'succeeded',
      result: { url: 'https://media.example/result.mp4' },
    });
    await cancelVideo('persisted');
    expect(cancelRemote).not.toHaveBeenCalled();
    expect(useVideoTasks.getState().tasks.persisted.assetSaved).toBe(true);
  });
  it('pausing queries never cancels the upstream generation', async () => {
    db.load.mockResolvedValue([task()]);
    await hydrateVideoTasks();
    await pauseVideo('persisted', true);
    expect(useVideoTasks.getState().tasks.persisted).toMatchObject({
      status: 'running',
      paused: true,
    });
    expect(cancelRemote).not.toHaveBeenCalled();
  });
});

describe('creation model and video record continuity', () => {
  it('switches media through the model choice without replacing either draft or frame references', () => {
    const image = customModel({
      provider: 'openai',
      id: 'gpt-image-1',
      label: 'Image',
      kind: 'image',
      vision: false,
      tools: false,
      references: true,
    });
    useAppStore.setState({
      activeSessionId: sessionId,
      models: [image, model],
      drafts: {
        [sessionId]: {
          studio: 'image draft',
          chat: '',
          studioAttachmentIds: ['image-ref'],
          chatAttachmentIds: [],
          video: { ...draft, firstFrameId: 'video-frame', style: 'cinematic' },
        },
      },
    });
    useAppStore.getState().setActiveCreationModel(model.key);
    expect(useAppStore.getState().preferences.studioMode).toBe('video');
    expect(useAppStore.getState().drafts[sessionId].video).toMatchObject({
      modelKey: model.key,
      prompt: draft.prompt,
      firstFrameId: 'video-frame',
      style: 'cinematic',
    });
    useAppStore.getState().setActiveCreationModel(image.key);
    expect(useAppStore.getState()).toMatchObject({
      activeImageModelKey: image.key,
      preferences: { studioMode: 'image' },
    });
    expect(useAppStore.getState().drafts[sessionId]).toMatchObject({
      studio: 'image draft',
      studioAttachmentIds: ['image-ref'],
      video: { prompt: draft.prompt, firstFrameId: 'video-frame' },
    });
  });
  it('persists provider elapsed time and the actual styled prompt while keeping the reusable draft original', async () => {
    await hydrateVideoTasks();
    createVideo.mockResolvedValue('cgt-styled');
    const styled = { ...draft, style: 'cinematic' as const };
    const prompt = videoStylePrompt(styled.prompt, styled.style);
    const id = await submitVideo(sessionId, model, styled, { ...input, prompt });
    queryVideo.mockResolvedValue({
      status: 'succeeded',
      elapsedMs: 42000,
      result: { url: 'https://media.example/styled.mp4' },
    });
    await refreshVideo(id!);
    const record = useVideoTasks.getState().tasks[id!];
    expect(record).toMatchObject({
      elapsedMs: 42000,
      submittedPrompt: prompt,
      draft: { prompt: draft.prompt, style: 'cinematic' },
      assetSaved: true,
    });
    expect(record.completedAt).toBeGreaterThan(0);
    const asset = useAppStore.getState().assets[`video-${id}`];
    expect(asset).toMatchObject({
      generationElapsedMs: 42000,
      prompt,
      originalPrompt: draft.prompt,
    });
    expect(db.assets).toHaveBeenCalledWith(
      expect.objectContaining({ elapsedMs: 42000 }),
      expect.objectContaining({ generationElapsedMs: 42000 }),
    );
    expect(videoStylePrompt(record.draft.prompt, record.draft.style)).toBe(prompt);
  });
  it('freezes elapsed time on completion and backfills old records from their saved update time', async () => {
    const original = { ...task(), status: 'failed' as const, createdAt: 1000, updatedAt: 31000 };
    db.load.mockResolvedValue([original]);
    await hydrateVideoTasks();
    const restored = useVideoTasks.getState().tasks.persisted;
    expect(restored).toMatchObject({ completedAt: 31000, elapsedMs: 30000 });
    expect(db.save).toHaveBeenCalledWith(expect.objectContaining({ elapsedMs: 30000 }));
    expect(withVideoTiming(restored, 900000).elapsedMs).toBe(30000);
    expect(withVideoTiming(task())).not.toHaveProperty('elapsedMs');
  });
  it('resumes legacy manual pauses automatically and resumes a blocked connection only after successful retry', async () => {
    db.load.mockResolvedValue([
      { ...task(), paused: true },
      { ...task('blocked'), paused: true, queryError: 'auth' },
    ]);
    await hydrateVideoTasks();
    expect(useVideoTasks.getState().tasks.persisted.paused).toBe(false);
    expect(useVideoTasks.getState().tasks.blocked.paused).toBe(true);
    queryVideo.mockResolvedValue({ status: 'running' });
    await refreshVideo('blocked', true);
    expect(useVideoTasks.getState().tasks.blocked).toMatchObject({
      paused: false,
      queryError: undefined,
    });
    expect(cancelRemote).not.toHaveBeenCalled();
  });
});

it.each([false, true])(
  'uses the current connection proxy choice for submit, restored query and cancellation (%s)',
  async (useWorkerProxy) => {
    const state = useAppStore.getState();
    state.setProviderConfig('volcengine', { useWorkerProxy });
    await hydrateVideoTasks();
    createVideo.mockResolvedValue('new-task');
    const id = await submitVideo(sessionId, model, draft, input);
    expect(createVideo.mock.calls[0][3].useProxy).toBe(useWorkerProxy);
    const saved = {
      ...useVideoTasks.getState().tasks[id!],
      status: 'queued' as const,
      paused: true,
    };
    useVideoTasks.setState(useVideoTasks.getInitialState(), true);
    db.load.mockResolvedValue([saved]);
    state.setProviderConfig('volcengine', { useWorkerProxy: !useWorkerProxy });
    await hydrateVideoTasks();
    queryVideo
      .mockResolvedValueOnce({ status: 'queued' })
      .mockResolvedValueOnce({ status: 'cancelled' });
    await cancelVideo(id!);
    expect(queryVideo.mock.calls.map((call) => call[2].useProxy)).toEqual([
      !useWorkerProxy,
      !useWorkerProxy,
    ]);
    expect(cancelRemote.mock.calls[0][2].useProxy).toBe(!useWorkerProxy);
  },
);

it('alerts once when a background query fails and alerts again only after connection recovery', async () => {
  useAppStore.setState({ activeView: 'gallery', activeSessionId: sessionId });
  db.load.mockResolvedValue([task()]);
  await hydrateVideoTasks();
  queryVideo.mockRejectedValue(new Error('temporary network error'));
  await refreshVideo('persisted', true);
  await refreshVideo('persisted', true);
  expect(useAppStore.getState().notices).toHaveLength(1);
  expect(useAppStore.getState().notices[0]).toMatchObject({
    title: '查询视频失败',
    source: 'video:persisted',
  });
  const noticeId = useAppStore.getState().notices[0].id;
  useAppStore.getState().dismissNotice(noticeId);
  await refreshVideo('persisted', true);
  expect(useAppStore.getState().activeNoticeIds).toEqual([]);
  queryVideo.mockResolvedValueOnce({ status: 'running' });
  await refreshVideo('persisted', true);
  queryVideo.mockRejectedValueOnce(new Error('temporary network error'));
  await refreshVideo('persisted', true);
  expect(useAppStore.getState().notices).toHaveLength(1);
  expect(useAppStore.getState().activeNoticeIds).toEqual([noticeId]);
});

it('keeps foreground task errors with the task instead of also sending a floating notification', async () => {
  useAppStore.setState({ activeView: 'studio', activeSessionId: sessionId });
  db.load.mockResolvedValue([task()]);
  await hydrateVideoTasks();
  queryVideo.mockRejectedValueOnce(new Error('query unavailable'));
  await refreshVideo('persisted', true);
  expect(useVideoTasks.getState().tasks.persisted.queryError).toBe('query unavailable');
  expect(useAppStore.getState().notices).toHaveLength(0);
});
