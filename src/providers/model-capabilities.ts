import type { ImageCapabilities, ImageParams, ModelCapabilities } from '@/types';

import { imageModelCapabilities } from './model-config';
import { matchImageModelConfig, textModelCapabilities } from './model-matching';
export { DEFAULT_IMAGE_PARAMS } from '@/lib/creation-defaults';

export function isGptImage(modelId: string): boolean {
  return /gpt-image|chatgpt-image/i.test(modelId);
}

export function isGrokImage(modelId: string): boolean {
  return /grok.*image|image.*grok|grok.*imagine|imagine.*image/i.test(modelId);
}

export function isNanoBanana(modelId: string, displayName = ''): boolean {
  return /banana|nano-b|nano_b/i.test(`${modelId} ${displayName}`);
}

export function isDallE(modelId: string): boolean {
  return /dall-e/i.test(modelId);
}

export function openAIImageCapabilities(modelId: string): ImageCapabilities {
  const configId = matchImageModelConfig('openai', modelId);
  return configId ? imageModelCapabilities(configId) : { aspects: [], maxCount: 1 };
}

export function textCapabilitiesForOpenAI(modelId: string): ModelCapabilities {
  return textModelCapabilities('openai', modelId);
}

export function xaiImageCapabilities(modelId: string): ImageCapabilities {
  return imageModelCapabilities(matchImageModelConfig('xai', modelId) ?? 'xai/grok-2-image');
}

export function googleImageCapabilities(modelId: string, _displayName = ''): ImageCapabilities {
  const configId = matchImageModelConfig('google', modelId);
  if (!configId) return { aspects: [], maxCount: 1, supportsEdit: false };
  const caps = imageModelCapabilities(configId);
  if (configId !== 'google/imagen-4.0' && /gemini-2\.5-flash-image/i.test(modelId))
    caps.maxReferences = imageModelCapabilities('google/gemini-2.5-flash-image').maxReferences;
  return caps;
}

export function prettifyModelId(modelId: string): string {
  return modelId
    .replace(/^models\//, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeImageParams(
  params: ImageParams,
  capabilities: ImageCapabilities | undefined,
): ImageParams {
  capabilities = capabilities ?? {};
  const aspects = capabilities.aspects ?? [];
  const aspect =
    params.aspect === 'auto'
      ? 'auto'
      : aspects.some((item) => item.value === params.aspect)
        ? params.aspect
        : (aspects[0]?.value ?? 'auto');

  const quality =
    capabilities.qualities && capabilities.qualities.length > 0
      ? capabilities.qualities.includes(params.quality ?? '')
        ? params.quality
        : capabilities.qualities[0]
      : undefined;

  const background =
    capabilities.backgrounds && capabilities.backgrounds.length > 0
      ? capabilities.backgrounds.some((item) => item.value === params.background)
        ? params.background
        : 'opaque'
      : undefined;

  const style =
    capabilities.styles && capabilities.styles.length > 0
      ? capabilities.styles.includes(params.style ?? '')
        ? params.style
        : capabilities.styles[0]
      : undefined;

  let outputFormat =
    capabilities.outputFormats && capabilities.outputFormats.length > 0
      ? capabilities.outputFormats.includes(params.outputFormat ?? '')
        ? params.outputFormat
        : capabilities.outputFormats[0]
      : undefined;

  if (background === 'transparent' && outputFormat === 'jpeg') outputFormat = 'png';

  const imageSize =
    capabilities.imageSizes && capabilities.imageSizes.length > 0
      ? capabilities.imageSizes.includes(params.imageSize ?? '')
        ? params.imageSize
        : capabilities.imageSizes[0]
      : undefined;

  const count = Math.min(
    Math.max(1, Number.isFinite(params.count) ? Math.round(params.count) : 1),
    capabilities.maxCount ?? 1,
  );

  return {
    aspect,
    quality,
    background,
    style,
    outputFormat,
    imageSize,
    count,
  };
}
