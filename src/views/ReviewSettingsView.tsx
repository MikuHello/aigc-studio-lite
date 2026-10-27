import { useAvailableModels } from '@/store/appStore';
import { RotateCcw } from 'lucide-react';
import type { ReviewSettings } from '@/types';
import { useAppStore } from '@/store/appStore';
import { DEFAULT_REVIEW_SETTINGS } from '@/lib/reviewSettings';
import { PageOverlay } from '@/components/ui/PageOverlay';
import { Select } from '@/components/ui/Select';
import { Field } from '@/components/ui/Field';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';

export function ReviewSettingsView({ onClose }: { onClose: () => void }) {
  const models = useAvailableModels().filter((model) => model.kind === 'text');
  const key = useAppStore((state) => state.preferences.reviewModelKey);
  const settings =
    useAppStore((state) => state.preferences.reviewSettings) ?? DEFAULT_REVIEW_SETTINGS;
  const setReviewModel = useAppStore((state) => state.setReviewModel);
  const setSettings = useAppStore((state) => state.setReviewSettings);
  const patch = (value: Partial<ReviewSettings>) => setSettings({ ...settings, ...value });
  return (
    <PageOverlay
      inline
      title="润色设置"
      onClose={onClose}
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={<RotateCcw size={15} />}
          title="重置改写规则和下方三个选项，保留已选模型"
          onClick={() => setSettings({ ...DEFAULT_REVIEW_SETTINGS })}
        >
          恢复默认
        </Button>
      }
    >
      <div className="review-settings-content">
        <Field
          label="润色模型"
          htmlFor="review-model"
          hint="独立于 Chat 模型，仅点击「润色」时调用。"
        >
          <Select
            id="review-model"
            value={models.some((model) => model.key === key) ? key! : ''}
            onChange={(value) => setReviewModel(value || null)}
            options={[
              { value: '', label: '请选择模型' },
              ...models.map((model) => ({
                value: model.key,
                label: `${model.label} · ${model.providerId}`,
              })),
            ]}
          />
        </Field>
        {!models.length && (
          <p className="settings-note">
            尚未添加文本模型。
            <button
              type="button"
              className="ui-text-button"
              onClick={() => useAppStore.getState().setActiveView('settings')}
            >
              前往设置
            </button>
          </p>
        )}
        <section className="review-config-section" aria-label="传递信息">
          <h2>传递信息</h2>
          <Switch
            label="目标图像模型"
            checked={settings.passTargetModel}
            onChange={(passTargetModel) => patch({ passTargetModel })}
          />
          <Switch
            label="画幅比例"
            checked={settings.passAspectRatio}
            onChange={(passAspectRatio) => patch({ passAspectRatio })}
          />
          <Switch
            label="参考上传图片"
            description="发送上传的参考图辅助理解，需使用支持识图的润色模型。"
            checked={settings.useReferenceImages}
            onChange={(useReferenceImages) => patch({ useReferenceImages })}
          />
        </section>
        <section className="review-config-section">
          <header className="review-rules-heading">
            <label htmlFor="review-rules">改写规则</label>
            <IconButton
              label="恢复默认改写规则"
              icon={<RotateCcw size={15} />}
              size="sm"
              onClick={() => patch({ rules: DEFAULT_REVIEW_SETTINGS.rules })}
            />
          </header>
          <textarea
            id="review-rules"
            className="ui-input review-rules-input"
            value={settings.rules}
            onChange={(event) => patch({ rules: event.target.value })}
            spellCheck={false}
          />
          <p className="settings-note">自动保存；规则与提示词一同发送给润色模型。</p>
        </section>
      </div>
    </PageOverlay>
  );
}
