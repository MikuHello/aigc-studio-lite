import type { ImageCapabilities, ModelDescriptor, ModelKind } from '@/types';
import { imageModelCapabilities } from './model-config';
import { matchImageModelConfig, textModelCapabilities } from './model-matching';
import { SEEDANCE_MODELS } from './video-capabilities';

export function arkImageCapabilities(id: string): ImageCapabilities {
  const configId = matchImageModelConfig('volcengine', id);
  return configId
    ? imageModelCapabilities(configId)
    : { aspects: [], maxCount: 1, supportsEdit: false };
}

export function arkModelKind(id: string, metadata: Record<string, unknown> = {}): ModelKind {
  const declared = [
    metadata.type,
    metadata.model_type,
    metadata.task_type,
    metadata.output_modalities,
  ]
    .flat()
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  if (/video/.test(declared)) return 'video';
  if (/image/.test(declared)) return 'image';
  if (/text|chat|language/.test(declared)) return 'text';
  if (/seedance|video/i.test(id)) return 'video';
  if (/seedream|seededit|image/i.test(id)) return 'image';
  return 'text';
}

export function arkDiscoveredModel(item: Record<string, unknown>): ModelDescriptor | null {
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  if (!id || /embedding|rerank|tts|asr/i.test(id)) return null;
  const kind = arkModelKind(id, item);
  const preset = kind === 'video' && SEEDANCE_MODELS.find((model) => model.modelId === id);
  if (preset) return structuredClone(preset);
  const image = kind === 'image' ? arkImageCapabilities(id) : undefined;
  const text = textModelCapabilities('volcengine', id);
  return {
    key: `volcengine::${id}`,
    providerId: 'volcengine',
    modelId: id,
    label: typeof item.name === 'string' ? item.name : id,
    kind,
    capabilities: {
      vision: kind === 'text' && text.vision,
      tools: kind === 'text' && text.tools,
      imageGeneration: kind === 'image',
      ...(image ? { image, imageEditing: Boolean(image.supportsEdit) } : {}),
    },
  };
}
