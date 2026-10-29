import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { failureNotice, makeNotice, noticeText, recordNotice } from '@/lib/notices';
import { snapshotMeta, useAppStore } from '@/store/appStore';

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));
afterEach(() => vi.restoreAllMocks());

it('dismisses presentation without losing the message or its details', () => {
  const state = useAppStore.getState();
  const id = state.notify({
    title: '获取模型失败',
    tone: 'error',
    detail: 'upstream detail',
    context: '供应商 A',
  });
  state.dismissNotice(id);
  expect(useAppStore.getState().activeNoticeIds).toEqual([]);
  expect(useAppStore.getState().notices).toMatchObject([
    { id, detail: 'upstream detail', context: '供应商 A' },
  ]);
  state.showNoticeDetails(useAppStore.getState().notices[0]);
  expect(useAppStore.getState().noticeDetails?.detail).toBe('upstream detail');
  expect(snapshotMeta(useAppStore.getState())).not.toHaveProperty('notices');
  expect(snapshotMeta(useAppStore.getState())).not.toHaveProperty('noticeDetails');
});

it('merges repeated events, preserves their original time and reopens dismissed feedback', () => {
  const first = makeNotice(
    { title: '连接失败', tone: 'error', detail: 'network', context: 'A' },
    'first',
    100,
  );
  const second = makeNotice(
    { title: '连接失败', tone: 'error', detail: 'network', context: 'A' },
    'second',
    200,
  );
  const result = recordNotice([first], second);
  expect(result.history).toHaveLength(1);
  expect(result.notice).toMatchObject({ id: 'first', createdAt: 100, updatedAt: 200 });
  const state = useAppStore.getState();
  const id = state.notify({ title: '连接失败', tone: 'error' });
  state.dismissNotice(id);
  expect(state.notify({ title: '连接失败', tone: 'error' })).toBe(id);
  expect(useAppStore.getState().activeNoticeIds).toEqual([id]);
});

it('keeps different contexts, reasons and severity separate', () => {
  const state = useAppStore.getState();
  state.notify({ title: '操作失败', context: 'A', detail: 'one', tone: 'error' });
  state.notify({ title: '操作失败', context: 'B', detail: 'one', tone: 'error' });
  state.notify({ title: '操作失败', context: 'A', detail: 'two', tone: 'error' });
  state.notify({ title: '操作失败', context: 'A', detail: 'one', tone: 'neutral' });
  expect(useAppStore.getState().notices).toHaveLength(4);
});

it('bounds both the visible queue and history without resurrecting old notices', () => {
  const state = useAppStore.getState();
  for (let index = 0; index < 60; index++) state.notify({ title: `结果 ${index}` });
  expect(useAppStore.getState().notices).toHaveLength(50);
  expect(useAppStore.getState().notices[0].title).toBe('结果 59');
  expect(useAppStore.getState().activeNoticeIds).toHaveLength(3);
  for (const id of useAppStore.getState().activeNoticeIds) state.dismissNotice(id);
  expect(useAppStore.getState().activeNoticeIds).toEqual([]);
  expect(useAppStore.getState().notices).toHaveLength(50);
  state.clearNotices();
  expect(useAppStore.getState().notices).toEqual([]);
});

it('redacts credentials before recording or opening details and retains the full safe error', () => {
  const secret = 'sk-test-secret';
  useAppStore.getState().setProviderConfig('openai', { apiKey: secret });
  const detail = `Incorrect API key provided: ${secret}. Authorization: Bearer token-456\nhttps://example.test?api_key=another-key&limit=1\n${'detail '.repeat(100)}tail-marker`;
  const state = useAppStore.getState();
  state.notify({ title: `请求失败 ${secret}`, detail, tone: 'error', context: `连接 ${secret}` });
  const saved = useAppStore.getState().notices[0];
  const serialized = JSON.stringify(saved);
  expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain('token-456');
  expect(serialized).not.toContain('another-key');
  expect(saved.detail).toContain('tail-marker');
  expect(saved.detail).toContain('limit=1');
  state.showNoticeDetails({ title: '操作失败', detail: secret });
  expect(useAppStore.getState().noticeDetails?.detail).toBe('[已隐藏]');
  expect(noticeText('Incorrect API key provided: 123.')).not.toContain('123');
});

it('keeps concise titles and complete details for long messages', () => {
  const full = 'error '.repeat(100) + 'tail-marker';
  const result = makeNotice({ title: full, tone: 'error' }, 'id', 1);
  expect(result.title.length).toBeLessThanOrEqual(80);
  expect(result.detail).toBe(full);
});

it('opening history details retains the recorded timestamp', () => {
  const state = useAppStore.getState();
  vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(200);
  state.notify({ title: '获取模型失败', tone: 'error' });
  state.notify({ title: '获取模型失败', tone: 'error' });
  const recorded = useAppStore.getState().notices[0];
  state.showNoticeDetails(recorded);
  expect(useAppStore.getState().noticeDetails).toEqual(recorded);
  expect(useAppStore.getState().notices).toHaveLength(1);
});

it('opens the requested supplier without persisting notification navigation', () => {
  const state = useAppStore.getState();
  state.setNoticeHistoryOpen(true);
  state.requestConnectionEdit('supplier-a');
  expect(useAppStore.getState()).toMatchObject({
    activeView: 'settings',
    connectionToEdit: 'supplier-a',
    noticeHistoryOpen: false,
  });
  expect(snapshotMeta(useAppStore.getState())).not.toHaveProperty('connectionToEdit');
});

it('keeps errors from different tasks separate even when their displayed messages match', () => {
  const state = useAppStore.getState();
  state.notify({ title: '查询失败', detail: 'network', tone: 'error', source: 'task:a' });
  state.notify({ title: '查询失败', detail: 'network', tone: 'error', source: 'task:b' });
  expect(useAppStore.getState().notices).toHaveLength(2);
});

it.each([
  [{ kind: 'auth', status: 401, message: 'invalid' }, '获取模型失败：API Key 无效'],
  [{ kind: 'network', status: 403, message: 'proxy denied' }, '获取模型失败：连接不可用'],
  [{ kind: 'rate-limit', message: 'quota' }, '获取模型失败：请求受限或额度不足'],
])('separates short operation results from complete error details', (error, title) => {
  const result = failureNotice('获取模型失败', Object.assign(new Error(error.message), error));
  expect(result.title).toBe(title);
  expect(result.detail).toHaveProperty('message', error.message);
});

it('retains image failure on its original session, redacts its error, and clears it independently', () => {
  const state = useAppStore.getState();
  const first = state.createSession('first');
  const second = state.createSession('second');
  state.setProviderConfig('openai', { apiKey: 'sk-image-secret' });
  const failure = {
    message: 'failed sk-image-secret',
    prompt: 'original prompt',
    modelLabel: 'image model',
    createdAt: 100,
  };
  state.setImageFailure(first, failure);
  const saved = snapshotMeta(useAppStore.getState());
  expect(saved.sessions.find((session) => session.id === first)?.imageFailure).toEqual({
    ...failure,
    message: 'failed [已隐藏]',
  });
  expect(saved.sessions.find((session) => session.id === second)?.imageFailure).toBeUndefined();
  state.setImageFailure(first, undefined);
  expect(
    useAppStore.getState().sessions.find((session) => session.id === first)?.imageFailure,
  ).toBeUndefined();
});

it.each([
  'Incorrect API key provided: old.secret.with.dots.',
  'Authorization: Bearer old+/base64=token',
  'Authorization: Basic dXNlcjpwYXNz',
])('redacts credentials that are no longer in the active connection configuration', (message) => {
  const text = noticeText(message);
  expect(text).toContain('[已隐藏]');
  expect(text).not.toContain('old');
  expect(text).not.toContain('dXNlcjpwYXNz');
});

it('redacts the request key after a connection changes before recording an image failure', () => {
  const state = useAppStore.getState();
  const sessionId = state.createSession('image request');
  state.setProviderConfig('openai', { apiKey: 'old-image-key' });
  const requestKey = useAppStore.getState().providerConfigs.openai.apiKey;
  state.setProviderConfig('openai', { apiKey: 'new-image-key' });
  state.setStudioMode('video');
  state.recordImageFailure(
    sessionId,
    {
      message: `request rejected ${requestKey}`,
      prompt: 'retained prompt',
      modelLabel: 'Image',
      createdAt: 100,
    },
    [requestKey],
  );
  const saved = snapshotMeta(useAppStore.getState());
  expect(saved.sessions[0].imageFailure?.message).toBe('request rejected [已隐藏]');
  expect(JSON.stringify(saved)).not.toContain(requestKey);
  const notice = useAppStore.getState().notices[0];
  expect(notice.detail).toBe('request rejected [已隐藏]');
  state.showNoticeDetails(notice);
  expect(useAppStore.getState().noticeDetails?.detail).not.toContain(requestKey);
});

it.each([
  ['studio', 'image', false],
  ['studio', 'video', true],
  ['settings', 'image', true],
] as const)('notifies only when the image failure is hidden in %s / %s', (view, mode, expected) => {
  const state = useAppStore.getState();
  const sessionId = state.createSession('image request');
  state.setActiveView(view);
  state.setStudioMode(mode);
  state.recordImageFailure(
    sessionId,
    {
      message: 'generation failed',
      prompt: 'prompt',
      modelLabel: 'Image',
      createdAt: 100,
    },
    [],
  );
  expect(useAppStore.getState().notices).toHaveLength(expected ? 1 : 0);
  expect(useAppStore.getState().sessions[0].imageFailure?.message).toBe('generation failed');
});
