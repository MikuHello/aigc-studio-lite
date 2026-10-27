import { useEffect, useState } from 'react';
import { CircleAlert, Copy, FileText, RotateCw, Trash2 } from 'lucide-react';
import type { Asset, VideoTask } from '@/types';
import { formatDateTime, formatDuration, copyText } from '@/lib/text';
import {
  cancelVideo,
  deleteVideoTask,
  needsVideoQuery,
  recoverVideo,
  refreshVideo,
  useVideoTasks,
} from '@/store/videoTasks';
import { useAppStore } from '@/store/appStore';
import { Button } from './ui/Button';
import { TextInput } from './ui/Field';
import { VideoPlayer } from './VideoPlayer';
import { GenerationProgress } from './GenerationProgress';
import { Dialog } from './Dialog';
import { Markdown } from './Markdown';

const LABELS: Record<VideoTask['status'], string> = {
  submitting: '正在提交',
  unknown: '提交结果待确认',
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '生成失败',
  cancelled: '已取消',
  expired: '任务已超时',
};

export function VideoTaskResult({ task, asset }: { task?: VideoTask; asset?: Asset }) {
  const busy = useVideoTasks((state) => Boolean(task && state.busy[task.id]));
  const [error, setError] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [remoteId, setRemoteId] = useState('');
  const result = task?.result ?? asset?.video;
  const prompt = task?.draft.prompt ?? asset?.prompt ?? '';
  const active = Boolean(task && ['submitting', 'queued', 'running'].includes(task.status));
  const polling = task && needsVideoQuery(task);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const elapsed = task
    ? (task.elapsedMs ??
      Math.max(0, (active ? now : (task.completedAt ?? task.updatedAt)) - task.createdAt))
    : asset?.generationElapsedMs;
  const action = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请重试。');
    }
  };
  const reuse = () => {
    const state = useAppStore.getState();
    if (task) state.setVideoDraft(state.activeSessionId, task.draft);
    else if (asset)
      state.setVideoDraft(state.activeSessionId, {
        prompt: asset.originalPrompt ?? prompt,
        modelKey: asset.modelKey ?? null,
        ...(asset.videoParams ? { params: asset.videoParams } : {}),
      });
    state.setStudioMode('video');
    state.setActiveView('studio');
  };
  return (
    <figure className="result-figure creation-video-result">
      {result ? (
        <VideoPlayer result={result} title={prompt || '生成视频'} />
      ) : (
        <div className="creation-task-state">
          {active || task?.status === 'succeeded' ? (
            <GenerationProgress
              elapsed={elapsed ?? 0}
              label={
                task?.queryError
                  ? '等待连接恢复'
                  : task?.status === 'succeeded'
                    ? '结果准备中'
                    : LABELS[task!.status]
              }
            />
          ) : (
            <>
              <CircleAlert size={26} strokeWidth={1.5} />
              <strong>{task ? LABELS[task.status] : '视频暂不可用'}</strong>
            </>
          )}
          {task?.error && (
            <p className="ui-field-error" role="alert">
              {task.error}
            </p>
          )}
        </div>
      )}
      {task?.queryError && (
        <p className="ui-field-error" role="alert">
          {task.queryError}
        </p>
      )}
      {error && (
        <p className="ui-field-error" role="alert">
          {error}
        </p>
      )}
      {task?.status === 'unknown' && !task.remoteId && (
        <div className="video-task-recovery">
          <TextInput
            aria-label="恢复任务编号"
            value={remoteId}
            onChange={(event) => setRemoteId(event.target.value.trim())}
            placeholder="填写火山控制台中的任务编号 cgt-…"
          />
          <Button
            size="sm"
            disabled={busy || !remoteId}
            onClick={() => void action(() => recoverVideo(task.id, remoteId))}
          >
            恢复查询
          </Button>
        </div>
      )}
      <div className="creation-result-actions">
        <Button
          size="sm"
          variant="ghost"
          icon={<FileText size={14} />}
          onClick={() => setRecordOpen(true)}
        >
          任务记录
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Copy size={14} />}
          onClick={() =>
            void action(async () => {
              await copyText(prompt);
              useAppStore.getState().addToast('已复制提示词');
            })
          }
        >
          复制提示词
        </Button>
        <Button size="sm" variant="secondary" onClick={reuse}>
          复用参数
        </Button>
        {task &&
          ((polling && (task.queryError || task.paused)) || (task.result && !task.assetSaved)) && (
            <Button
              size="sm"
              icon={<RotateCw size={13} />}
              disabled={busy}
              onClick={() => void action(() => refreshVideo(task.id, true))}
            >
              {busy ? '重试中' : task.result ? '重新保存' : '重试连接'}
            </Button>
          )}
        {task?.status === 'queued' && (
          <Button size="sm" disabled={busy} onClick={() => void action(() => cancelVideo(task.id))}>
            取消排队
          </Button>
        )}
      </div>
      <Dialog open={recordOpen} onClose={() => setRecordOpen(false)} title="任务记录" size="wide">
        <div className="generation-record">
          <dl>
            <div>
              <dt>模型</dt>
              <dd>{task?.model.label ?? asset?.modelLabel}</dd>
            </div>
            <div>
              <dt>时间</dt>
              <dd>{formatDateTime(task?.createdAt ?? asset?.createdAt ?? 0)}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{task ? LABELS[task.status] : '已完成'}</dd>
            </div>
            {elapsed !== undefined && (
              <div>
                <dt>耗时</dt>
                <dd>{formatDuration(elapsed)}</dd>
              </div>
            )}
            <div>
              <dt>画幅 / 清晰度</dt>
              <dd>
                {(task?.draft.params.ratio ?? asset?.videoParams?.ratio) === 'adaptive'
                  ? '自动比例'
                  : (task?.draft.params.ratio ?? asset?.videoParams?.ratio)}{' '}
                · {task?.draft.params.resolution ?? asset?.videoParams?.resolution}
              </dd>
            </div>
            <div>
              <dt>时长</dt>
              <dd>
                {(task?.draft.params.duration ?? asset?.videoParams?.duration) === -1
                  ? '自动'
                  : `${task?.draft.params.duration ?? asset?.videoParams?.duration ?? result?.duration ?? '—'} 秒`}
              </dd>
            </div>
          </dl>
          <h3>提示词</h3>
          <Markdown content={prompt} />
          {task?.remoteId && (
            <>
              <h3>任务编号</h3>
              <div className="video-task-id">
                <code>{task.remoteId}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void action(() => copyText(task.remoteId!))}
                >
                  复制编号
                </Button>
              </div>
            </>
          )}
          {task && !polling && task.status !== 'submitting' && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={13} />}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await deleteVideoTask(task.id);
                  setRecordOpen(false);
                })
              }
            >
              移除任务记录
            </Button>
          )}
        </div>
      </Dialog>
    </figure>
  );
}
