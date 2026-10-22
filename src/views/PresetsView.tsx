import { useMemo, useState } from 'react';
import { Copy, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { PromptPreset } from '@/types';
import { markdownPreview, copyText } from '@/lib/text';
import { useAppStore } from '@/store/appStore';
import { PageOverlay } from '@/components/ui/PageOverlay';
import { Button } from '@/components/ui/Button';
import { RowMenu } from '@/components/ui/RowMenu';
import { EmptyState } from '@/components/ui/EmptyState';
import { PresetEditorDialog } from '@/components/PresetEditorDialog';
import { ConfirmDialog } from '@/components/TextDialogs';

interface PresetsViewProps {
  onClose: () => void;
}

export function PresetsView({ onClose }: PresetsViewProps) {
  const presets = useAppStore((state) => state.presets);
  const deletePreset = useAppStore((state) => state.deletePreset);
  const addToast = useAppStore((state) => state.addToast);

  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<PromptPreset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptPreset | null>(null);

  const tags = useMemo(
    () => Array.from(new Set(presets.flatMap((preset) => preset.tags))).sort(),
    [presets],
  );

  const effectiveTag = tag && tags.includes(tag) ? tag : null;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return presets.filter((preset) => {
      if (effectiveTag && !preset.tags.includes(effectiveTag)) return false;
      if (!normalized) return true;
      return (
        preset.title.toLowerCase().includes(normalized) ||
        preset.content.toLowerCase().includes(normalized) ||
        preset.tags.some((item) => item.toLowerCase().includes(normalized))
      );
    });
  }, [presets, query, effectiveTag]);

  const createPreset = () => {
    setEditingPreset(null);
    setEditorOpen(true);
  };

  const editPreset = (preset: PromptPreset) => {
    setEditingPreset(preset);
    setEditorOpen(true);
  };

  return (
    <PageOverlay inline title="预设管理" onClose={onClose} className="presets-overlay">
      <div className="presets-toolbar">
        <label className="ui-search-field presets-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索预设"
            aria-label="搜索预设"
          />
        </label>
        <Button variant="primary" icon={<Plus size={16} />} onClick={createPreset}>
          新建预设
        </Button>
      </div>

      {tags.length > 0 && (
        <div className="preset-filter-bar" role="group" aria-label="按标签筛选">
          <button
            type="button"
            className={`preset-filter ${effectiveTag === null ? 'is-active' : ''}`}
            aria-pressed={effectiveTag === null}
            onClick={() => setTag(null)}
          >
            全部
          </button>
          {tags.map((item) => (
            <button
              key={item}
              type="button"
              className={`preset-filter ${effectiveTag === item ? 'is-active' : ''}`}
              aria-pressed={effectiveTag === item}
              onClick={() => setTag(effectiveTag === item ? null : item)}
            >
              {item}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState title={presets.length === 0 ? '还没有预设' : '没有匹配的预设'} />
      ) : (
        <ul className="preset-grid">
          {filtered.map((preset) => (
            <li key={preset.id}>
              <article className="preset-card">
                <header>
                  <button type="button" className="preset-title" onClick={() => editPreset(preset)}>
                    {preset.title}
                  </button>
                  <RowMenu
                    label={`${preset.title}的操作`}
                    actions={[
                      {
                        label: '编辑',
                        icon: Pencil,
                        onSelect: () => editPreset(preset),
                      },
                      {
                        label: '复制内容',
                        icon: Copy,
                        onSelect: async () => {
                          try {
                            await copyText(preset.content);
                            addToast('已复制预设内容', 'success');
                          } catch {
                            addToast('复制失败，请重试或打开预设手动复制。', 'error');
                          }
                        },
                      },
                      {
                        label: '删除',
                        icon: Trash2,
                        danger: true,
                        onSelect: () => setDeleteTarget(preset),
                      },
                    ]}
                  />
                </header>
                <p className="preset-card-content">{markdownPreview(preset.content, 190)}</p>
                <footer>
                  <ul className="preset-card-tags">
                    {preset.tags.map((item) => (
                      <li key={item}>#{item}</li>
                    ))}
                  </ul>
                </footer>
              </article>
            </li>
          ))}
        </ul>
      )}

      <PresetEditorDialog
        open={editorOpen}
        preset={editingPreset}
        onClose={() => {
          setEditorOpen(false);
          setEditingPreset(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除预设？"
        description={deleteTarget ? `「${deleteTarget.title}」将被移除。` : ''}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deletePreset(deleteTarget.id);
            addToast('预设已删除');
          }
        }}
      />
    </PageOverlay>
  );
}
