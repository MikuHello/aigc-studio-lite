import { Sparkles } from 'lucide-react';
import { formatDuration } from '@/lib/text';

export function GenerationProgress({
  elapsed,
  label = '正在生成',
}: {
  elapsed: number;
  label?: string;
}) {
  return (
    <div className="generation-progress" role="status" aria-live="polite">
      <div className="generation-hologram" aria-hidden="true">
        <i />
        <span>
          <Sparkles size={26} strokeWidth={1.3} />
        </span>
      </div>
      <strong>{label}</strong>
      <time aria-live="off" aria-label="已用时间">
        {formatDuration(elapsed)}
      </time>
    </div>
  );
}
