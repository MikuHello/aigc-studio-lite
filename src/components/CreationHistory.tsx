import { CircleAlert, Film, LoaderCircle } from 'lucide-react';
import type { CreationHistoryEntry } from '@/lib/creationHistory';

export function CreationHistory({
  entries,
  selectedId,
  onSelect,
}: {
  entries: CreationHistoryEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="generation-history" aria-label="生成记录">
      <div className="generation-history-list">
        {entries.map((entry, index) => {
          const task = entry.kind === 'video' ? entry.task : undefined;
          const pending = task && ['submitting', 'queued', 'running'].includes(task.status);
          const failed = task && ['failed', 'expired', 'unknown'].includes(task.status);
          const result = entry.kind === 'video' ? (task?.result ?? entry.asset?.video) : undefined;
          return (
            <button
              key={entry.id}
              type="button"
              className={`history-item ${entry.id === selectedId ? 'is-active' : ''}`}
              aria-label={`查看第 ${index + 1} ${entry.kind === 'image' ? '张生成图' : '条视频记录'}`}
              title={
                task?.draft.prompt ||
                entry.asset?.prompt ||
                (entry.kind === 'video' ? '视频' : '图片')
              }
              aria-pressed={entry.id === selectedId}
              onClick={() => onSelect(entry.id)}
            >
              {entry.kind === 'image' ? (
                <img src={entry.asset.dataUrl} alt="" loading="lazy" />
              ) : (
                <div className="history-video-preview">
                  {result?.lastFrameUrl ? (
                    <img src={result.lastFrameUrl} alt="" loading="lazy" />
                  ) : pending ? (
                    <LoaderCircle size={21} className="spin" />
                  ) : failed ? (
                    <CircleAlert size={21} />
                  ) : (
                    <Film size={21} />
                  )}
                  {result?.url && !result.lastFrameUrl && (
                    <video
                      key={result.url}
                      src={result.url}
                      preload="metadata"
                      muted
                      playsInline
                      tabIndex={-1}
                      aria-hidden="true"
                      onError={(event) => {
                        event.currentTarget.hidden = true;
                      }}
                    />
                  )}
                  <span>{pending ? '生成中' : failed ? '未完成' : '视频'}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
