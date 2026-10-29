import { modelSupportReason, refreshModelCapabilities } from '@/providers/model-support';
import { modelConnection, connectionIdFor } from '@/lib/connections';
import { create } from 'zustand';
import { useEffect } from 'react';
import type { Asset, GenerateVideoInput, ModelDescriptor, VideoDraft, VideoTask } from '@/types';
import { adapters } from '@/providers';
import { ProviderError } from '@/providers/types';
import { withVideoTiming } from '@/lib/videoTiming';
import { validateVideoInput } from '@/lib/video';
import { createId } from '@/lib/id';
import { loadVideoTasks, saveVideoTask, removeVideoTask, saveVideoResult } from '@/lib/storage';
import { useAppStore } from './appStore';

interface VideoTaskState {
  tasks: Record<string, VideoTask>;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  busy: Record<string, boolean>;
}

export const useVideoTasks = create<VideoTaskState>(() => ({
  tasks: {},
  loaded: false,
  loading: false,
  error: null,
  busy: {},
}));
const submitting = new Set<string>();
const nextQuery = new Map<string, number>();
const failures = new Map<string, number>();

export function needsVideoQuery(task: VideoTask): boolean {
  return (
    Boolean(task.remoteId) &&
    (['queued', 'running', 'unknown', 'submitting'].includes(task.status) ||
      (task.status === 'succeeded' && !task.result))
  );
}

const message = (error: unknown) => (error instanceof Error ? error.message : '操作失败，请重试。');

async function persist(task: VideoTask) {
  task = withVideoTiming(task);
  useVideoTasks.setState((state) => ({ tasks: { ...state.tasks, [task.id]: task } }));
  try {
    await saveVideoTask(task);
  } catch (error) {
    useVideoTasks.setState((state) => ({
      tasks: {
        ...state.tasks,
        [task.id]: {
          ...task,
          paused: true,
          queryError: `本地保存失败，请勿关闭页面。${message(error)}`,
        },
      },
    }));
    throw error;
  }
}

export async function hydrateVideoTasks() {
  if (useVideoTasks.getState().loading || useVideoTasks.getState().loaded) return;
  useVideoTasks.setState({ loading: true, error: null });
  try {
    const loadedTasks = await loadVideoTasks();
    const tasks = loadedTasks.map((task) => {
      const timed = withVideoTiming(task, task.updatedAt);
      return needsVideoQuery(timed) && timed.paused && !timed.queryError
        ? { ...timed, paused: false }
        : timed;
    });
    await Promise.all(
      tasks.filter((task, index) => task !== loadedTasks[index]).map((task) => saveVideoTask(task)),
    );
    useVideoTasks.setState({
      loaded: true,
      tasks: Object.fromEntries(
        tasks.map((task) => [
          task.id,
          task.status === 'submitting' && !task.remoteId
            ? {
                ...task,
                status: 'unknown',
                paused: true,
                error: '提交期间页面关闭，结果待确认。请在火山控制台查询任务编号后恢复。',
              }
            : task,
        ]),
      ),
    });
  } catch (error) {
    useVideoTasks.setState({ error: `任务记录读取失败：${message(error)}` });
  } finally {
    useVideoTasks.setState({ loading: false });
  }
}

function connection(task: VideoTask) {
  const state = useAppStore.getState();
  const config = modelConnection(
    state.providerConfigs,
    { providerId: task.providerId, connectionId: task.connectionId ?? task.model.connectionId },
    true,
  );
  if (!config?.apiKey)
    throw new ProviderError('请在设置中配置此任务使用的 API Key。', { kind: 'auth' });
  if (config.baseUrl.replace(/\/+$/, '') !== task.baseUrl.replace(/\/+$/, ''))
    throw new ProviderError('连接地址已改变，请恢复任务提交时的连接地址后继续查询。', {
      kind: 'auth',
    });
  const adapter = adapters[task.providerId]?.video;
  if (!adapter) throw new Error('此服务商尚未接入视频任务。');
  return {
    config: { ...config },
    adapter,
    options: {
      useProxy: config.useWorkerProxy === true,
      signal: AbortSignal.timeout(45000),
    },
  };
}

async function saveResult(task: VideoTask) {
  task = useVideoTasks.getState().tasks[task.id] ?? task;
  if (!task.result || task.assetSaved) return;
  const id = `video-${task.id}`;
  const asset: Asset = {
    id,
    sessionId: task.sessionId,
    source: 'generated',
    mimeType: 'video/mp4',
    dataUrl: '',
    video: task.result,
    videoParams: task.draft.params,
    prompt: task.submittedPrompt ?? task.draft.prompt,
    originalPrompt:
      task.submittedPrompt && task.submittedPrompt !== task.draft.prompt
        ? task.draft.prompt
        : undefined,
    generationElapsedMs: task.elapsedMs,
    modelKey: task.model.key,
    modelLabel: task.model.label,
    providerId: task.providerId,
    createdAt: task.createdAt,
  };
  const completed = { ...task, assetSaved: true, queryError: undefined };
  await saveVideoResult(completed, asset);
  useVideoTasks.setState((state) => ({ tasks: { ...state.tasks, [task.id]: completed } }));
  useAppStore.setState((state) => ({ assets: { ...state.assets, [id]: asset } }));
}

export async function submitVideo(
  sessionId: string,
  model: ModelDescriptor,
  draft: VideoDraft,
  input: GenerateVideoInput,
) {
  if (submitting.has(sessionId)) return;
  if (!useVideoTasks.getState().loaded) throw new Error('任务记录尚未载入，请稍后重试。');
  if (!useAppStore.getState().sessions.some((session) => session.id === sessionId)) return;
  model = refreshModelCapabilities(model);
  const reason = modelSupportReason(model);
  if (reason) throw new Error(reason);
  validateVideoInput(model, input);
  const config = modelConnection(useAppStore.getState().providerConfigs, model);
  submitting.add(sessionId);
  let task: VideoTask = {
    id: createId('video-task'),
    sessionId,
    providerId: model.providerId,
    connectionId: connectionIdFor(model),
    baseUrl: config.baseUrl,
    model: structuredClone(model),
    draft: structuredClone(draft),
    submittedPrompt: input.prompt,
    status: 'submitting',
    paused: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  try {
    const { adapter, config, options } = connection(task);
    try {
      await persist(task);
    } catch (error) {
      useVideoTasks.setState((state) => ({
        tasks: {
          ...state.tasks,
          [task.id]: {
            ...task,
            status: 'failed',
            paused: true,
            error: '本地保存失败，尚未向服务商提交。',
          },
        },
      }));
      throw error;
    }
    try {
      const remoteId = await adapter.createVideo(config, model, input, options);
      task = { ...task, remoteId, status: 'queued', updatedAt: Date.now() };
    } catch (error) {
      const rejected =
        error instanceof ProviderError &&
        error.status &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408;
      task = {
        ...task,
        status: rejected ? 'failed' : 'unknown',
        paused: true,
        error: rejected ? message(error) : `提交结果待确认，请勿直接重复生成。${message(error)}`,
      };
    }
    await persist(task);
    return task.id;
  } finally {
    submitting.delete(sessionId);
  }
}

async function withTaskLock(id: string, action: (task: VideoTask) => Promise<void>) {
  const state = useVideoTasks.getState();
  if (state.busy[id] || !state.tasks[id]) return;
  useVideoTasks.setState((s) => ({ busy: { ...s.busy, [id]: true } }));
  try {
    await action(state.tasks[id]);
  } finally {
    useVideoTasks.setState((s) => ({ busy: { ...s.busy, [id]: false } }));
  }
}

export async function refreshVideo(id: string, resume = false) {
  await withTaskLock(id, async (task) => {
    try {
      if (task.result) {
        await saveResult(task);
        return;
      }
      if (!task.remoteId) return;
      const { config, adapter, options } = connection(task);
      const update = await adapter.queryVideo(config, task.remoteId, options);
      const current = useVideoTasks.getState().tasks[id];
      if (!current) return;
      task = {
        ...current,
        ...update,
        paused: resume ? false : current.paused,
        updatedAt: Date.now(),
        queryError: undefined,
      };
      await persist(task);
      failures.delete(id);
      nextQuery.set(id, Date.now() + 8000);
      await saveResult(task);
    } catch (error) {
      const current = useVideoTasks.getState().tasks[id];
      if (!current) return;
      const count = (failures.get(id) ?? 0) + 1;
      failures.set(id, count);
      nextQuery.set(id, Date.now() + Math.min(120000, 8000 * 2 ** count));
      const paused =
        current.paused ||
        (error instanceof ProviderError && (error.kind === 'auth' || error.status === 404));
      await persist({ ...current, paused, queryError: message(error) }).catch(() => {});
    }
  });
}

export async function pauseVideo(id: string, paused: boolean) {
  await withTaskLock(id, async (task) => {
    await persist({ ...task, paused });
    nextQuery.delete(id);
  });
}

export async function recoverVideo(id: string, remoteId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(remoteId)) throw new Error('请输入有效的任务编号。');
  await withTaskLock(id, async (task) => {
    if (task.remoteId || task.status !== 'unknown') return;
    const { config, adapter, options } = connection(task);
    const result = await adapter.queryVideo(config, remoteId, options);
    await persist({
      ...task,
      ...result,
      remoteId,
      paused: false,
      error: result.error,
      updatedAt: Date.now(),
    });
  });
  await refreshVideo(id);
}

export async function cancelVideo(id: string) {
  await withTaskLock(id, async (task) => {
    if (task.status !== 'queued' || !task.remoteId) return;
    const { config, adapter, options } = connection(task);
    if (!adapter.cancelVideo) throw new Error('此平台不支持取消任务。');
    const latest = await adapter.queryVideo(config, task.remoteId, options);
    if (latest.status !== 'queued') {
      const updated = { ...task, ...latest, updatedAt: Date.now(), queryError: undefined };
      await persist(updated);
      await saveResult(updated);
      return;
    }
    await adapter.cancelVideo(config, task.remoteId, options);
    try {
      const latest = await adapter.queryVideo(config, task.remoteId, options);
      const updated = {
        ...task,
        ...latest,
        paused: latest.status === 'cancelled',
        updatedAt: Date.now(),
        queryError: undefined,
      };
      await persist(updated);
      await saveResult(updated);
    } catch (error) {
      await persist({
        ...task,
        paused: true,
        queryError: `已发送取消请求，请手动刷新确认最终状态。${message(error)}`,
      });
    }
  });
}

export async function deleteVideoTask(id: string) {
  await withTaskLock(id, async (task) => {
    if (needsVideoQuery(task) || task.status === 'submitting')
      throw new Error('请等待任务结束后再删除记录。');
    await removeVideoTask(id);
    useVideoTasks.setState((state) => {
      const tasks = { ...state.tasks };
      delete tasks[id];
      return { tasks };
    });
  });
}

export function useVideoTaskRunner() {
  const hydrated = useAppStore((state) => state.hydrated);
  useEffect(() => {
    if (!hydrated) return;
    void hydrateVideoTasks();
    const tick = () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine) return;
      for (const task of Object.values(useVideoTasks.getState().tasks)) {
        if (Object.values(useVideoTasks.getState().busy).filter(Boolean).length >= 3) break;
        if (task.paused || (nextQuery.get(task.id) ?? 0) > Date.now()) continue;
        if (needsVideoQuery(task) && Date.now() - task.createdAt > 7 * 24 * 60 * 60 * 1000) {
          void pauseVideo(task.id, true).catch(() => {});
          continue;
        }
        if (needsVideoQuery(task) || (task.result && !task.assetSaved))
          void refreshVideo(task.id).catch(() => {});
      }
    };
    const timer = window.setInterval(tick, 2000);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [hydrated]);
}
