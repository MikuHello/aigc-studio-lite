import { failureNotice } from '@/lib/notices';
import { useAppStore } from '@/store/appStore';
import { modelSupportReason, refreshModelCapabilities } from '@/providers/model-support';
import { useState } from 'react';
import { Search } from 'lucide-react';
import type { ModelDescriptor, ModelKind, ProviderConfig } from '@/types';
import { Dialog } from './Dialog';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { SegmentedControl } from './ui/SegmentedControl';

export const MODEL_KIND_LABELS: Record<ModelKind, string> = {
  text: '文字',
  image: '图片',
  video: '视频',
};

export function SupplierModelPicker({
  models,
  config,
  enabled,
  onClose,
  onSave,
  onConfigure,
}: {
  models: ModelDescriptor[];
  config?: ProviderConfig;
  enabled: ModelDescriptor[];
  onClose: () => void;
  onSave: (models: ModelDescriptor[]) => Promise<void>;
  onConfigure: (model: ModelDescriptor) => void;
}) {
  const [selected, setSelected] = useState(new Set(enabled.map((model) => model.modelId)));
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ModelKind | 'all'>('all');
  const [saving, setSaving] = useState(false);
  const visible = models.filter(
    (model) =>
      (kind === 'all' || model.kind === kind) &&
      `${model.label} ${model.modelId}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const save = async () => {
    setSaving(true);
    try {
      await onSave(models.filter((model) => selected.has(model.modelId)));
      onClose();
      useAppStore.getState().notify({ title: '已保存模型', tone: 'success' });
    } catch (error) {
      useAppStore.getState().notify(failureNotice('保存模型失败', error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      title="选择启用模型"
      size="wide"
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <>
          <span className="supplier-selection-count">已选 {selected.size} 个</span>
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中' : '保存选择'}
          </Button>
        </>
      }
    >
      <div className="supplier-model-picker">
        <label className="ui-search-field">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索模型名称或 ID"
            aria-label="搜索供应商模型"
          />
        </label>
        <SegmentedControl<ModelKind | 'all'>
          value={kind}
          onChange={setKind}
          ariaLabel="模型类型筛选"
          options={[
            { value: 'all', label: '全部' },
            { value: 'text', label: '文字' },
            { value: 'image', label: '图片' },
            { value: 'video', label: '视频' },
          ]}
        />
        <div className="supplier-model-bulk">
          <Button
            size="sm"
            variant="ghost"
            disabled={saving || !visible.length}
            onClick={() =>
              setSelected(
                (previous) =>
                  new Set([
                    ...previous,
                    ...visible
                      .filter(
                        (model) => !modelSupportReason(refreshModelCapabilities(model), config),
                      )
                      .map((model) => model.modelId),
                  ]),
              )
            }
          >
            选择当前结果
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={saving || !visible.length}
            onClick={() =>
              setSelected(
                (previous) =>
                  new Set(
                    [...previous].filter((id) => !visible.some((model) => model.modelId === id)),
                  ),
              )
            }
          >
            取消当前结果
          </Button>
        </div>
        <div className="supplier-candidate-list">
          {visible.map((model) => (
            <div key={model.modelId} className="supplier-candidate">
              <Checkbox
                checked={selected.has(model.modelId)}
                disabled={
                  saving || Boolean(modelSupportReason(refreshModelCapabilities(model), config))
                }
                label={model.label}
                onChange={(checked) =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    if (checked) next.add(model.modelId);
                    else next.delete(model.modelId);
                    return next;
                  })
                }
              />
              <span className="supplier-model-kind">{MODEL_KIND_LABELS[model.kind]}</span>
              <code>{model.modelId}</code>
              {modelSupportReason(refreshModelCapabilities(model), config) && (
                <p className="supplier-inline-note">
                  {modelSupportReason(refreshModelCapabilities(model), config)}
                </p>
              )}
              {modelSupportReason(refreshModelCapabilities(model), config) && (
                <Button size="sm" variant="ghost" onClick={() => onConfigure(model)}>
                  配置模型规格
                </Button>
              )}
            </div>
          ))}
          {!visible.length && (
            <p className="supplier-empty-copy">没有匹配的模型。可返回获取模型，或手动添加。</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
