import type { ModelCapabilities, ProviderId } from '@/types';
import { findImageModelConfigId } from './model-config';

export function matchImageModelConfig(provider: ProviderId, id: string): string | undefined {
  const mapped = findImageModelConfigId(provider, id);
  if (mapped) return mapped;
  if (provider === 'openai') {
    if (/gpt-image|chatgpt-image/i.test(id)) {
      if (/(?:gpt|chatgpt)-image-2\.5/i.test(id)) return 'openai/gpt-image-2.5';
      if (/(?:gpt|chatgpt)-image-2(?:[.-]|$)/i.test(id)) return 'openai/gpt-image-2';
      return 'openai/gpt-image-1.5';
    }
    if (/dall-e/i.test(id)) return /dall-e-3/i.test(id) ? 'openai/dall-e-3' : 'openai/dall-e-2';
  }
  if (provider === 'google') {
    if (/imagen/i.test(id)) return 'google/imagen-4.0';
    if (/gemini-3(?:\.1)?-(?:pro|flash).*image|gemini-nano-banana-2\.1/i.test(id)) {
      return /flash-lite-image/i.test(id)
        ? 'google/gemini-3.1-flash-lite-image'
        : 'google/gemini-3-pro-image';
    }
    if (/gemini-2\.5-flash-image/i.test(id)) return 'google/gemini-2.5-flash-image';
  }
  if (provider === 'xai' && /grok-imagine-image/i.test(id)) return 'xai/grok-imagine-image';
  if (provider === 'volcengine' && /seedream-(?:4[-.]0|4[-.]5|5[-.]0)/i.test(id)) {
    if (/seedream-5[-.]0/i.test(id))
      return /lite/i.test(id) ? 'volcengine/seedream-5.0-lite' : 'volcengine/seedream-5.0';
    return /seedream-4[-.]5/i.test(id) ? 'volcengine/seedream-4.5' : 'volcengine/seedream-4.0';
  }
  return undefined;
}

export function textModelCapabilities(provider: ProviderId, modelId: string): ModelCapabilities {
  const id = modelId.toLowerCase();
  if (provider === 'anthropic') return { vision: true, tools: true, imageGeneration: false };
  if (provider === 'google')
    return { vision: /gemini/.test(id), tools: /gemini/.test(id), imageGeneration: false };
  const vision =
    /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|chatgpt|(^|[-_/])o[134]([-_]|$)|vision|(^|[-_/])vl([-_]|$)|multimodal|omni|llava|pixtral|gemma-3|deepseek[-_]?vl)/.test(
      id,
    );
  const tools =
    /(gpt-4|gpt-5|gpt-3\.5|chatgpt|o1|o3|o4|claude|gemini|deepseek|qwen|llama|mistral|grok)/.test(
      id,
    ) && !/instruct|base|embedding/.test(id);
  return {
    vision:
      vision ||
      (provider === 'xai' && /grok-(3|4|vision)/.test(id)) ||
      (provider === 'volcengine' && /doubao-seed|vision/.test(id)),
    tools: tools || (provider === 'volcengine' && /doubao-seed/.test(id)),
    imageGeneration: false,
  };
}
