import { imageCapabilitiesFor, IMAGE_PROFILES, imageCapabilityId } from '@/providers/model-support';
import { arkModelKind } from '@/providers/ark-models';
import { textModelCapabilities } from '@/providers/model-matching';
import { SEEDANCE_MODELS } from '@/providers/video-capabilities';
import type { ModelDescriptor, ModelKind, ProviderId } from '@/types';
import { isGptImage, isDallE, isGrokImage, isNanoBanana } from '@/providers/model-capabilities';

export function customModel(input: {
  provider: ProviderId;
  id: string;
  label: string;
  kind: ModelKind;
  vision: boolean;
  tools: boolean;
  references: boolean;
  videoProfile?: string;
  imageProfile?: string;
}): ModelDescriptor {
  const modelId = input.id.trim();
  if (!modelId || /\s/.test(modelId)) throw new Error('模型 ID 不能为空或包含空白字符。');
  if (input.kind === 'video') {
    if (input.provider !== 'volcengine') throw new Error('请使用已接入的视频协议。');
    const profile =
      SEEDANCE_MODELS.find((model) => model.modelId === modelId) ??
      SEEDANCE_MODELS.find((model) => model.modelId === input.videoProfile);
    if (!profile) throw new Error('请选择模型规格，确保时长和分辨率符合实际模型。');
    return {
      ...structuredClone(profile),
      key: `${input.provider}::${modelId}`,
      modelId,
      label: input.label.trim() || profile.label,
      manual: true,
      capabilityProfileId: profile.modelId,
    };
  }
  if (input.provider === 'anthropic' && input.kind === 'image')
    throw new Error('Anthropic 协议不支持图像生成。');
  if (
    input.imageProfile &&
    !IMAGE_PROFILES[input.provider]?.some((profile) => profile.value === input.imageProfile)
  )
    throw new Error('图片模型规格与接入方式不匹配。');
  const image =
    input.kind === 'image'
      ? imageCapabilitiesFor(
          input.provider,
          imageCapabilityId({
            providerId: input.provider,
            modelId,
            capabilityProfileId: input.imageProfile,
          }),
        )
      : undefined;
  return {
    key: `${input.provider}::${modelId}`,
    providerId: input.provider,
    modelId,
    label: input.label.trim() || modelId,
    kind: input.kind,
    manual: true,
    ...(input.kind === 'image' && input.imageProfile
      ? { capabilityProfileId: input.imageProfile }
      : {}),
    capabilities: {
      vision: input.kind === 'text' && input.vision,
      tools: input.kind === 'text' && input.tools,
      imageGeneration: input.kind === 'image',
      ...(image
        ? {
            imageEditing: input.references && Boolean(image.supportsEdit),
            image: { ...image, supportsEdit: input.references && Boolean(image.supportsEdit) },
          }
        : {}),
    },
  };
}

export function suggestCustomModel(provider: ProviderId, id: string) {
  const image =
    provider === 'google'
      ? /imagen|gemini.*image/i.test(id) || isNanoBanana(id)
      : provider === 'xai'
        ? isGrokImage(id)
        : provider === 'openai' && (isGptImage(id) || isDallE(id));
  const kind: ModelKind = provider === 'volcengine' ? arkModelKind(id) : image ? 'image' : 'text';
  const caps = imageCapabilitiesFor(provider, id);
  const text = textModelCapabilities(provider, id);
  return {
    kind,
    references: kind === 'image' && Boolean(caps.supportsEdit),
    vision: text.vision,
    tools: text.tools,
  };
}
