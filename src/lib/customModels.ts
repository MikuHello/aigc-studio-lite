import type { ModelDescriptor, ModelKind, ProviderId } from '@/types';
import {
  googleImageCapabilities,
  openAIImageCapabilities,
  xaiImageCapabilities,
} from '@/providers/model-capabilities';

export function customModel(input: {
  provider: ProviderId;
  id: string;
  label: string;
  kind: ModelKind;
  vision: boolean;
  tools: boolean;
  references: boolean;
}): ModelDescriptor {
  const modelId = input.id.trim();
  if (!modelId || /\s/.test(modelId)) throw new Error('模型 ID 不能为空或包含空白字符。');
  if (input.provider === 'anthropic' && input.kind === 'image')
    throw new Error('Anthropic 协议不支持图像生成。');
  const image =
    input.kind === 'image'
      ? input.provider === 'google'
        ? googleImageCapabilities(modelId)
        : input.provider === 'xai'
          ? xaiImageCapabilities(modelId)
          : openAIImageCapabilities(modelId)
      : undefined;
  return {
    key: `${input.provider}::${modelId}`,
    providerId: input.provider,
    modelId,
    label: input.label.trim() || modelId,
    kind: input.kind,
    manual: true,
    capabilities: {
      vision: input.kind === 'text' && input.vision,
      tools: input.kind === 'text' && input.tools,
      imageGeneration: input.kind === 'image',
      ...(image
        ? {
            imageEditing: input.references && input.provider !== 'xai',
            image: { ...image, supportsEdit: input.references && input.provider !== 'xai' },
          }
        : {}),
    },
  };
}

export function mergeDiscoveredModels(discovered: ModelDescriptor[], previous: ModelDescriptor[]) {
  const models = new Map(discovered.map((model) => [model.key, model]));
  for (const model of previous) if (model.manual) models.set(model.key, model);
  return [...models.values()];
}
