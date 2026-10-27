import { ReferenceHelp } from './ReferenceHelp';
import { useState } from 'react';
import { ArrowLeft, Film, Image, Music2, Plus, X, LoaderCircle } from 'lucide-react';
import type { Asset, ReferenceKind } from '@/types';
import { referenceKind, referenceSource } from '@/lib/referenceMedia';
import { Dialog } from './Dialog';
import { IconButton } from './ui/IconButton';

export function ReferencePreview({
  source,
  kind,
  label,
}: {
  source: string;
  kind: ReferenceKind;
  label: string;
}) {
  if (kind === 'image' && source && !source.startsWith('asset://'))
    return <img className="reference-preview" src={source} alt={label} draggable={false} />;
  if (kind === 'video' && source && !source.startsWith('asset://'))
    return (
      <span className="reference-video-preview">
        <video src={source} preload="metadata" muted playsInline />
        <Film size={18} />
      </span>
    );
  const Icon = kind === 'audio' ? Music2 : kind === 'video' ? Film : Image;
  return (
    <span className={`reference-symbol is-${kind}`} role="img" aria-label={label}>
      <Icon size={24} />
      {kind === 'audio' && (
        <span className="reference-audio-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </span>
  );
}

export function ReferenceTray({
  items,
  onAdd,
  onRemove,
  onMove,
  busy = false,
  title = '参考素材',
  hint,
  help,
  addLabel = '添加参考素材',
}: {
  items: Array<{ asset: Asset; label: string }>;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMove?: (index: number) => void;
  busy?: boolean;
  title?: string;
  hint?: string;
  help?: { title: string; details: string[] };
  addLabel?: string;
}) {
  const [preview, setPreview] = useState<Asset | null>(null);
  return (
    <section className="reference-tray" aria-label={title}>
      <div className="reference-tray-heading">
        <span>{title}</span>
        {help && <ReferenceHelp {...help} />}
        {items.length > 0 && <span className="reference-count">已选 {items.length}</span>}
        {hint && <span className="reference-tray-hint">{hint}</span>}
      </div>
      <div className="reference-tray-items">
        <button
          className="reference-add"
          type="button"
          aria-label={addLabel}
          disabled={busy}
          onClick={onAdd}
        >
          {busy ? (
            <LoaderCircle size={23} className="spin" />
          ) : (
            <Plus size={24} strokeWidth={1.5} />
          )}
          <span>{busy ? '读取素材中' : addLabel}</span>
        </button>
        {items.length > 0 && (
          <div className="reference-tile-scroll">
            {items.map(({ asset, label }, index) => (
              <div className="reference-tile" key={asset.id}>
                <button
                  className="reference-tile-preview"
                  type="button"
                  aria-label={`预览${label}`}
                  title={asset.filename ?? asset.prompt ?? label}
                  onClick={() => setPreview(asset)}
                >
                  <ReferencePreview
                    source={referenceSource(asset)}
                    kind={referenceKind(asset)}
                    label={label}
                  />
                  <span className="reference-tile-label">{label}</span>
                  {(asset.media?.durationSeconds ?? asset.video?.duration) !== undefined && (
                    <span className="reference-duration">
                      {(asset.media?.durationSeconds ?? asset.video?.duration)?.toFixed(1)}s
                    </span>
                  )}
                </button>
                <div className="reference-tile-actions">
                  {onMove && index > 0 && (
                    <IconButton
                      label={`前移${label}`}
                      size="sm"
                      icon={<ArrowLeft size={12} />}
                      disabled={busy}
                      onClick={() => onMove(index)}
                    />
                  )}
                  <IconButton
                    label={`移除${label}`}
                    size="sm"
                    icon={<X size={13} />}
                    disabled={busy}
                    onClick={() => onRemove(asset.id)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Dialog
        open={Boolean(preview)}
        title={preview?.filename ?? '预览参考素材'}
        onClose={() => setPreview(null)}
        size="wide"
      >
        {preview && (
          <div className="reference-full-preview">
            {referenceKind(preview) === 'image' ? (
              <ReferencePreview source={referenceSource(preview)} kind="image" label="参考图" />
            ) : referenceSource(preview).startsWith('asset://') ? (
              <p>素材 ID 暂不支持预览。</p>
            ) : referenceKind(preview) === 'video' ? (
              <video src={referenceSource(preview)} controls playsInline />
            ) : (
              <audio src={referenceSource(preview)} controls />
            )}
          </div>
        )}
      </Dialog>
    </section>
  );
}
