import type { VideoTask } from '@/types';

export function withVideoTiming(task: VideoTask, now = Date.now()): VideoTask {
  if (!['succeeded', 'failed', 'cancelled', 'expired'].includes(task.status)) return task;
  if (task.completedAt !== undefined && task.elapsedMs !== undefined) return task;
  const completedAt = task.completedAt ?? now;
  return {
    ...task,
    completedAt,
    elapsedMs: task.elapsedMs ?? Math.max(0, completedAt - task.createdAt),
  };
}
