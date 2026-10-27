import { IMAGE_PROFILES, imageCapabilitiesFor, imageCapabilityId } from '@/providers/model-support';
import { useState } from 'react';
import type { ModelDescriptor, ModelKind, ProviderId } from '@/types';
import { customModel, suggestCustomModel } from '@/lib/customModels';
import { SEEDANCE_MODELS } from '@/providers/video-capabilities';
import { Dialog } from './Dialog';
import { Field, TextInput } from './ui/Field';
import { Select } from './ui/Select';
import { Checkbox } from './ui/Checkbox';
import { Button } from './ui/Button';

export function SupplierModelEditor({
  provider,
  model,
  onClose,
  onSave,
}: {
  provider: ProviderId;
  model?: ModelDescriptor;
  onClose: () => void;
  onSave: (model: ModelDescriptor) => Promise<void>;
}) {
  const [id, setId] = useState(model?.modelId ?? '');
  const [name, setName] = useState(model?.label ?? '');
  const [kind, setKind] = useState<ModelKind>(model?.kind ?? 'text');
  const [profile, setProfile] = useState(
    model?.capabilityProfileId ??
      SEEDANCE_MODELS.find((item) => item.modelId === model?.modelId)?.modelId ??
      '',
  );
  const [imageProfile, setImageProfile] = useState(
    model?.kind === 'image' ? (model.capabilityProfileId ?? '') : '',
  );
  const inferredImageCaps = imageCapabilitiesFor(provider, id);
  const imageCaps = imageCapabilitiesFor(
    provider,
    imageCapabilityId({ providerId: provider, modelId: id, capabilityProfileId: imageProfile }),
  );
  const [vision, setVision] = useState(model?.capabilities.vision ?? false);
  const [tools, setTools] = useState(model?.capabilities.tools ?? false);
  const [references, setReferences] = useState(model?.capabilities.image?.supportsEdit ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(
        customModel({
          provider,
          id,
          label: name,
          kind,
          vision,
          tools,
          references,
          videoProfile: profile,
          imageProfile,
        }),
      );
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存模型失败。');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      title={model ? '编辑模型' : '手动添加模型'}
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <>
          <Button disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={saving || !id.trim()} onClick={() => void save()}>
            {saving ? '保存中' : '保存模型'}
          </Button>
        </>
      }
    >
      <div className="supplier-form">
        <Field label="模型 ID" htmlFor="supplier-model-id">
          <TextInput
            id="supplier-model-id"
            value={id}
            disabled={saving}
            onChange={(event) => {
              const value = event.target.value;
              setId(value);
              if (!model) {
                const suggestion = suggestCustomModel(provider, value);
                setKind(suggestion.kind);
                setVision(suggestion.vision);
                setTools(suggestion.tools);
                setReferences(suggestion.references);
              }
            }}
            placeholder={provider === 'volcengine' ? '模型 ID 或 ep-…' : '服务提供的模型 ID'}
          />
        </Field>
        <Field label="显示名称" htmlFor="supplier-model-name">
          <TextInput
            id="supplier-model-name"
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
            placeholder="可选"
          />
        </Field>
        <Field label="模型类型" htmlFor="supplier-model-kind">
          <Select
            id="supplier-model-kind"
            value={kind}
            onChange={(value) => setKind(value as ModelKind)}
            disabled={saving}
            options={
              provider === 'volcengine'
                ? [
                    { value: 'text', label: '文字' },
                    { value: 'image', label: '图片' },
                    { value: 'video', label: '视频' },
                  ]
                : [
                    { value: 'text', label: '文字' },
                    ...(provider === 'anthropic' ? [] : [{ value: 'image', label: '图片' }]),
                  ]
            }
          />
        </Field>
        {kind === 'video' && !SEEDANCE_MODELS.some((item) => item.modelId === id.trim()) && (
          <Field label="模型规格" htmlFor="supplier-model-profile">
            <Select
              id="supplier-model-profile"
              value={profile}
              onChange={setProfile}
              options={[
                { value: '', label: '选择模型规格' },
                ...SEEDANCE_MODELS.map((item) => ({ value: item.modelId, label: item.label })),
              ]}
            />
          </Field>
        )}
        {kind === 'text' && (
          <div className="supplier-model-flags">
            <Checkbox checked={vision} onChange={setVision} label="支持图片理解" />
            <Checkbox checked={tools} onChange={setTools} label="支持工具调用" />
          </div>
        )}
        {kind === 'image' && !inferredImageCaps.aspects?.length && (
          <Field
            label="图片模型规格"
            htmlFor="supplier-image-profile"
            hint="使用模型别名或 Endpoint ID 时，按上游文档选择对应规格。"
          >
            <Select
              id="supplier-image-profile"
              value={imageProfile}
              onChange={(value) => {
                setImageProfile(value);
                setReferences(Boolean(imageCapabilitiesFor(provider, value || id).supportsEdit));
              }}
              disabled={saving}
              options={[
                { value: '', label: '按模型 ID 识别' },
                ...(IMAGE_PROFILES[provider] ?? []),
              ]}
            />
          </Field>
        )}
        {kind === 'image' && imageCaps.supportsEdit && (
          <Checkbox checked={references} onChange={setReferences} label="支持参考图" />
        )}
        {error && (
          <p className="ui-field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
