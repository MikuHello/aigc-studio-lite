import { InlineNotice } from './ui/Feedback';
import { useRef, useState } from 'react';
import { Check, Upload, Link2 } from 'lucide-react';
import type { Asset, ReferenceKind } from '@/types';
import { referenceKind, referenceSource } from '@/lib/referenceMedia';
import { useReferenceDrop } from '@/hooks/useReferenceDrop';
import { Dialog } from './Dialog';
import { Button } from './ui/Button';
import { SegmentedControl } from './ui/SegmentedControl';
import { ReferencePreview } from './ReferenceTray';

export function ReferencePicker({
  open,
  onClose,
  assets,
  selectedIds,
  onSelect,
  onFiles,
  onError,
  busy,
  accept,
  allowLink = false,
  durationLimits,
  onLink,
  error,
  title = '添加参考素材',
  uploadHint = 'PNG、JPEG、WebP · 每张不超过 12 MB',
}: {
  open: boolean;
  onClose: () => void;
  assets: Asset[];
  selectedIds: string[];
  onSelect: (asset: Asset) => void;
  onFiles: (files: File[]) => void | Promise<void>;
  onError: (message: string) => void;
  busy?: boolean;
  accept: string;
  allowLink?: boolean;
  durationLimits?: Record<'video' | 'audio', { min: number; max: number }>;
  onLink?: (url: string, kind: ReferenceKind, durationSeconds?: number) => Promise<void>;
  error?: string;
  title?: string;
  uploadHint?: string;
}) {
  const [tab, setTab] = useState<'upload' | 'library' | 'link'>('upload');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<ReferenceKind>('video');
  const [duration, setDuration] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { dragActive, dropHandlers } = useReferenceDrop(
    {
      onFiles,
      onAsset: (id) => {
        const asset = assets.find((item) => item.id === id);
        if (asset) onSelect(asset);
      },
      onError,
    },
    busy,
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="wide"
      footer={
        <Button onClick={onClose}>
          完成{selectedIds.length ? ` · 已选 ${selectedIds.length}` : ''}
        </Button>
      }
    >
      <SegmentedControl<'upload' | 'library' | 'link'>
        ariaLabel="素材来源"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upload', label: '上传文件' },
          { value: 'library', label: '作品库' },
          ...(allowLink ? [{ value: 'link' as const, label: '链接' }] : []),
        ]}
      />
      <div className="reference-picker-body" {...dropHandlers}>
        {tab === 'upload' && (
          <>
            <input
              ref={input}
              type="file"
              accept={accept}
              multiple
              hidden
              onChange={(event) => {
                void onFiles(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              className={`reference-upload-zone ${dragActive ? 'is-dragging' : ''}`}
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Upload size={28} strokeWidth={1.4} />
              <strong>
                {busy ? '正在读取素材…' : dragActive ? '松开以添加素材' : '拖入文件，或点击上传'}
              </strong>
              <span>{uploadHint}</span>
            </button>
            {allowLink && (
              <button
                className="reference-link-shortcut"
                type="button"
                onClick={() => {
                  setTab('link');
                  setKind('video');
                }}
              >
                <Link2 size={15} />
                参考视频？添加视频链接，或从作品库选择
              </button>
            )}
          </>
        )}
        {tab === 'library' &&
          (assets.length ? (
            <div className="reference-library">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className={selectedIds.includes(asset.id) ? 'is-selected' : ''}
                  aria-pressed={selectedIds.includes(asset.id)}
                  disabled={busy}
                  onClick={() => onSelect(asset)}
                >
                  <ReferencePreview
                    source={referenceSource(asset)}
                    kind={referenceKind(asset)}
                    label={asset.filename ?? '参考素材'}
                  />
                  <span>{asset.filename || asset.prompt?.slice(0, 32) || '生成作品'}</span>
                  {selectedIds.includes(asset.id) && (
                    <Check className="reference-selected" size={18} />
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p className="reference-picker-empty">还没有可选素材，先上传一份吧。</p>
          ))}
        {tab === 'link' && allowLink && (
          <div className="reference-link-form">
            <SegmentedControl<ReferenceKind>
              ariaLabel="链接素材类型"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'video', label: '视频' },
                { value: 'audio', label: '音频' },
                { value: 'image', label: '图片' },
              ]}
            />
            <label>
              素材链接
              <input
                className="ui-input"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  onError('');
                }}
                placeholder="https://… 或 asset://…"
              />
            </label>
            {url.trim().startsWith('asset://') && kind !== 'image' && (
              <label>
                素材时长（秒）
                <input
                  className="ui-input"
                  type="number"
                  min={durationLimits?.[kind]?.min}
                  max={durationLimits?.[kind]?.max}
                  step="0.1"
                  value={duration}
                  onChange={(event) => {
                    setDuration(event.target.value);
                    onError('');
                  }}
                />
              </label>
            )}
            <p>支持公开可访问的链接或火山素材 ID，链接需在生成完成前有效。</p>
            <p>
              {kind === 'video'
                ? 'MP4 / MOV · ≤200 MB · 24–60 FPS'
                : kind === 'audio'
                  ? 'MP3 / WAV · ≤15 MB'
                  : '图片尺寸需为 300–6000 像素，宽高比 0.4–2.5。'}
            </p>
            <Button
              variant="primary"
              disabled={busy || !url.trim()}
              onClick={() => {
                void onLink?.(url.trim(), kind, duration ? Number(duration) : undefined)
                  .then(() => setUrl(''))
                  .catch(() => {});
              }}
            >
              添加链接素材
            </Button>
          </div>
        )}
        <InlineNotice field message={error} />
      </div>
    </Dialog>
  );
}
