import { failureNotice } from '@/lib/notices';
import { ASSET_DRAG_TYPE } from '@/lib/referenceMedia';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useMemo, useState } from 'react';
import { Search, Check, Trash2, ListChecks, Film } from 'lucide-react';
import type { Asset } from '@/types';
import { formatDateTime, markdownPreview } from '@/lib/text';
import { useAppStore } from '@/store/appStore';
import { PageOverlay } from '@/components/ui/PageOverlay';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { ImageLightbox } from '@/components/ImageLightbox';

type GalleryScope = 'all' | 'session';

interface GalleryViewProps {
  onClose: () => void;
}

export function GalleryView({ onClose }: GalleryViewProps) {
  const sessionId = useAppStore((state) => state.activeSessionId);
  const assets = useAppStore((state) => state.assets);
  const deleteAsset = useAppStore((state) => state.deleteAsset);

  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [scope, setScope] = useState<GalleryScope>('all');
  const [mediaKind, setMediaKind] = useState<'all' | 'image' | 'video'>('all');
  const [query, setQuery] = useState('');
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const allAssets = useMemo(
    () =>
      Object.values(assets)
        .filter((asset) => asset.source === 'generated')
        .sort((a, b) => b.createdAt - a.createdAt),
    [assets],
  );
  const sourceAssets =
    scope === 'all' ? allAssets : allAssets.filter((asset) => asset.sessionId === sessionId);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const typedAssets = sourceAssets.filter(
      (asset) =>
        mediaKind === 'all' || (mediaKind === 'video' ? Boolean(asset.video) : !asset.video),
    );
    if (!normalized) return typedAssets;
    return typedAssets.filter(
      (asset) =>
        asset.prompt?.toLowerCase().includes(normalized) ||
        asset.modelLabel?.toLowerCase().includes(normalized),
    );
  }, [sourceAssets, query, mediaKind]);
  const selectedVisible = filtered.filter((asset) => selectedIds.has(asset.id));
  const allSelected = filtered.length > 0 && selectedVisible.length === filtered.length;
  const toggleSelection = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const lightboxAsset = lightboxId ? assets[lightboxId] : null;

  return (
    <PageOverlay title="作品库" onClose={onClose} className="gallery-overlay">
      <div className="gallery-toolbar">
        <label className="ui-search-field gallery-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIds(new Set());
            }}
            placeholder="搜索提示词或模型"
            aria-label="搜索作品库"
          />
        </label>
        <SegmentedControl
          value={scope}
          onChange={(value) => {
            setScope(value);
            setSelectedIds(new Set());
          }}
          ariaLabel="作品范围"
          options={[
            { value: 'all', label: '全部作品' },
            { value: 'session', label: '当前会话' },
          ]}
        />
        <Select
          id="gallery-media-kind"
          value={mediaKind}
          onChange={(value) => {
            setMediaKind(value);
            setSelectedIds(new Set());
          }}
          options={[
            { value: 'all', label: '图片与视频' },
            { value: 'image', label: '图片' },
            { value: 'video', label: '视频' },
          ]}
        />
        {filtered.length > 0 && (
          <div className="gallery-selection-actions">
            {selecting && (
              <>
                <Checkbox
                  label="全选"
                  checked={allSelected}
                  disabled={deleting || !filtered.length}
                  onChange={(checked) =>
                    setSelectedIds(new Set(checked ? filtered.map((asset) => asset.id) : []))
                  }
                />
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 size={14} />}
                  disabled={!selectedVisible.length || deleting}
                  onClick={() => setConfirmIds(selectedVisible.map((asset) => asset.id))}
                >
                  删除{selectedVisible.length ? ` (${selectedVisible.length})` : ''}
                </Button>
              </>
            )}
            <Button
              size="sm"
              icon={<ListChecks size={15} />}
              disabled={deleting}
              onClick={() => {
                setSelecting(!selecting);
                setSelectedIds(new Set());
              }}
            >
              {selecting ? '取消选择' : '多选'}
            </Button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          showGlyph={false}
          description={query ? undefined : '生成的作品会保存在这里'}
          title={query ? '没有匹配的作品' : '还没有作品'}
        >
          {scope === 'session' && allAssets.length > 0 && (
            <button type="button" className="ui-text-button" onClick={() => setScope('all')}>
              查看全部作品
            </button>
          )}
        </EmptyState>
      ) : (
        <ul className="gallery-grid">
          {filtered.map((asset) => (
            <GalleryItem
              key={asset.id}
              asset={asset}
              selecting={selecting}
              selected={selectedIds.has(asset.id)}
              onOpen={() => (selecting ? toggleSelection(asset.id) : setLightboxId(asset.id))}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmIds.length > 0}
        title={`删除 ${confirmIds.length} 件作品？`}
        description="所选作品将从作品库、会话及参考图中移除，此操作无法撤销。"
        onClose={() => {
          if (!deleting) setConfirmIds([]);
        }}
        onConfirm={async () => {
          setDeleting(true);
          try {
            for (const id of confirmIds) await deleteAsset(id);
            setSelectedIds(new Set());
            useAppStore
              .getState()
              .notify({ title: `已删除 ${confirmIds.length} 件作品`, tone: 'success' });
          } catch (error) {
            useAppStore.getState().notify(failureNotice('删除作品失败', error));
          } finally {
            setDeleting(false);
            setConfirmIds([]);
          }
        }}
      />
      <ImageLightbox
        asset={lightboxAsset ?? null}
        onClose={() => setLightboxId(null)}
        onDelete={(assetId) => {
          return deleteAsset(assetId);
        }}
      />
    </PageOverlay>
  );
}

function GalleryItem({
  asset,
  onOpen,
  selecting,
  selected,
}: {
  asset: Asset;
  onOpen: () => void;
  selecting: boolean;
  selected: boolean;
}) {
  return (
    <li>
      <figure className={`gallery-item ${selected ? 'is-selected' : ''}`}>
        <div
          className={`gallery-image ${
            asset.params?.background === 'transparent' ? 'is-transparent' : ''
          }`}
        >
          <button
            type="button"
            draggable
            onDragStart={(event) => event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id)}
            onClick={onOpen}
            aria-label={
              selecting
                ? `${selected ? '取消选择' : '选择'}图像 ${asset.filename ?? asset.id}`
                : asset.video
                  ? '查看视频详情'
                  : '查看图像详情'
            }
            aria-pressed={selecting ? selected : undefined}
          >
            {asset.video ? (
              <span className="gallery-video-thumb">
                <Film size={32} />
                <span>{asset.video.duration ? `${asset.video.duration} 秒` : '视频'}</span>
              </span>
            ) : (
              <img
                src={asset.dataUrl}
                alt={asset.prompt?.slice(0, 100) ?? '生成图像'}
                loading="lazy"
                decoding="async"
              />
            )}
            {selecting && (
              <span
                className={`gallery-select-mark ${selected ? 'is-selected' : ''}`}
                aria-hidden="true"
              >
                {selected && <Check size={15} />}
              </span>
            )}
          </button>
        </div>
        <figcaption>
          <span>{markdownPreview(asset.prompt ?? '', 90)}</span>
          <span>
            {asset.modelLabel}
            <span aria-hidden="true"> / </span>
            {formatDateTime(asset.createdAt)}
          </span>
        </figcaption>
      </figure>
    </li>
  );
}
