import { Sparkles } from 'lucide-react';
import { formatDuration } from '@/lib/text';

export function GenerationProgress({ elapsed }: { elapsed: number }) {
  return (
    <div className="generation-progress" role="status" aria-live="polite">
      <div className="generation-hologram" aria-hidden="true">
        <i />
        <span>
          <Sparkles size={26} strokeWidth={1.3} />
        </span>
      </div>
      <strong>正在生成</strong>
      <time aria-live="off">{formatDuration(elapsed)}</time>
    </div>
  );
}
