import type {
  ConnectionMeta,
  ChatRoundInput,
  GenerateImageInput,
  ImageCapabilities,
  ModelDescriptor,
  ProviderId,
} from '@/types';
import { arkImageCapabilities } from './ark-models';
import {
  googleImageCapabilities,
  normalizeImageParams,
  openAIImageCapabilities,
  xaiImageCapabilities,
} from './model-capabilities';
import { SEEDANCE_MODELS } from './video-capabilities';

import { imageModelOptions } from './model-config';

export const IMAGE_PROFILES = imageModelOptions();

export function imageCapabilitiesFor(provider: ProviderId, id: string): ImageCapabilities {
  if (provider === 'google') return googleImageCapabilities(id);
  if (provider === 'xai') return xaiImageCapabilities(id);
  if (provider === 'volcengine') return arkImageCapabilities(id);
  return openAIImageCapabilities(id);
}

export function imageCapabilityId(
  model: Pick<ModelDescriptor, 'providerId' | 'modelId' | 'capabilityProfileId'>,
): string {
  const known = imageCapabilitiesFor(model.providerId, model.modelId);
  return known.aspects?.length ||
    (model.providerId === 'xai' && /^grok-2-image/i.test(model.modelId))
    ? model.modelId
    : model.capabilityProfileId || model.modelId;
}

export function refreshModelCapabilities(model: ModelDescriptor): ModelDescriptor {
  if (model.kind === 'video') {
    const preset =
      SEEDANCE_MODELS.find((p) => p.modelId === model.modelId) ??
      SEEDANCE_MODELS.find((p) => p.modelId === model.capabilityProfileId);
    return model.providerId === 'volcengine' && preset
      ? { ...model, capabilities: structuredClone(preset.capabilities) }
      : model;
  }
  if (model.kind !== 'image') return model;
  const image = imageCapabilitiesFor(model.providerId, imageCapabilityId(model));
  if (model.manual && model.capabilities.image?.supportsEdit === false) image.supportsEdit = false;
  return {
    ...model,
    capabilities: {
      vision: false,
      tools: false,
      imageGeneration: true,
      imageEditing: Boolean(image.supportsEdit),
      image,
    },
  };
}

export function modelSupportReason(
  model: ModelDescriptor,
  config?: Pick<ConnectionMeta, 'baseUrl'>,
): string | undefined {
  const id = model.modelId.replace(/^models\//, '');
  if (
    model.kind === 'image' &&
    model.capabilityProfileId &&
    !IMAGE_PROFILES[model.providerId]?.some((p) => p.value === model.capabilityProfileId)
  )
    return '图片模型规格与接入方式不匹配。';
  if (
    model.kind === 'image' &&
    model.providerId === 'volcengine' &&
    /seededit|seedream-3/i.test(id)
  )
    return '当前尚未适配此旧版图片接口，请选择 Seedream 4.0 或更新规格。';
  if (
    /embedding|rerank|tts|transcri|whisper|realtime|native-audio|(^|[-_])audio|lyria|moderation/i.test(
      id,
    )
  )
    return '该模型的音频、嵌入或专用接口尚未接入。';
  if (
    /seedance|sora|veo|(^|[-_])video([-_]|$)/i.test(id) &&
    (model.providerId !== 'volcengine' || model.kind !== 'video')
  )
    return '该视频模型的生成接口尚未接入。';
  if (
    model.kind === 'video' &&
    (model.providerId !== 'volcengine' ||
      !SEEDANCE_MODELS.some(
        (p) => p.modelId === model.modelId || p.modelId === model.capabilityProfileId,
      ))
  )
    return '请配置已支持的视频模型规格。';
  if (model.kind === 'image' && model.providerId === 'anthropic')
    return '该接入方式不支持图片生成。';
  if (
    model.kind === 'image' &&
    model.providerId === 'google' &&
    !imageCapabilitiesFor('google', imageCapabilityId(model)).aspects?.length
  )
    return '请配置已支持的 Gemini 图片模型规格。';
  if (
    model.kind === 'image' &&
    model.providerId === 'volcengine' &&
    !imageCapabilitiesFor('volcengine', imageCapabilityId(model)).supportsEdit
  )
    return '请配置已支持的 Seedream 图片模型规格。';
  let host = '';
  try {
    host = new URL(config?.baseUrl ?? '').hostname;
  } catch {}
  if (host === 'api.openai.com' && /^(dall-e-[23]|gpt-image-1)$/.test(id))
    return '该模型已在 OpenAI 官方下线，请选择当前可用的 GPT Image 模型。';
  if (host === 'generativelanguage.googleapis.com' && /^imagen/i.test(imageCapabilityId(model)))
    return 'Imagen 已在 Gemini API 下线，请选择 Gemini 图片模型。';
  if (
    host === 'api.openai.com' &&
    /^(gpt-3\.5-turbo(?:-0125|-completions)?|gpt-4(?:-0613|-0613-completions|-completions|-1106-preview)?|gpt-4-turbo(?:-2024-04-09|-completions)?|gpt-4\.1-nano(?:-2025-04-14)?|gpt-4o-2024-05-13|o1(?:-2024-12-17)?|o1-pro(?:-2025-03-19)?|o3-mini(?:-2025-01-31)?|o4-mini(?:-2025-04-16)?)$/.test(
      id,
    )
  )
    return '该旧版模型已在 OpenAI 官方下线，请选择当前可用模型。';
  if (host === 'api.x.ai' && id === 'grok-imagine-image-pro')
    return '该旧版图片模型已退役，请选择 Grok Imagine Image。';
  return undefined;
}

export function assertChatSupport(
  config: Pick<ConnectionMeta, 'baseUrl'>,
  model: ModelDescriptor,
  input: ChatRoundInput,
) {
  const reason = modelSupportReason(model, config);
  if (reason) throw new Error(reason);
  if (model.kind !== 'text') throw new Error('请选择文字模型。');
  if (input.tools.length && !model.capabilities.tools)
    throw new Error('当前模型未启用工具调用能力。');
  if (input.messages.some((message) => message.images?.length) && !model.capabilities.vision)
    throw new Error('当前模型未启用图片理解能力。');
}

export function prepareImageRequest(
  config: Pick<ConnectionMeta, 'baseUrl'>,
  model: ModelDescriptor,
  input: GenerateImageInput,
) {
  model = refreshModelCapabilities(model);
  const reason = modelSupportReason(model, config);
  if (reason) throw new Error(reason);
  if (model.kind !== 'image') throw new Error('请选择图片模型。');
  const caps = model.capabilities.image!;
  if (input.references.length && !caps.supportsEdit)
    throw new Error('当前模型不支持参考图，请移除参考图或切换模型。');
  if (input.references.length > (caps.maxReferences ?? 0))
    throw new Error(`当前模型最多支持 ${caps.maxReferences ?? 0} 张参考图。`);
  if (
    model.providerId === 'google' &&
    new TextEncoder().encode(JSON.stringify(input.references)).length +
      new TextEncoder().encode(input.prompt).length >
      19 * 1024 * 1024
  )
    throw new Error('Google 内联图片请求过大，请压缩图片或减少参考图（请求上限 20 MB）。');
  return { model, caps, input: { ...input, params: normalizeImageParams(input.params, caps) } };
}
