import type { AspectOption, ImageCapabilities, ImageParams, ModelCapabilities } from '@/types';

export const GPT_IMAGE_ASPECTS: AspectOption[] = [
  { value: '1:1', label: '1 : 1', ratioW: 1, ratioH: 1, apiSize: '1024x1024' },
  { value: '3:2', label: '3 : 2', ratioW: 3, ratioH: 2, apiSize: '1536x1024' },
  { value: '2:3', label: '2 : 3', ratioW: 2, ratioH: 3, apiSize: '1024x1536' },
];

export const GPT_IMAGE_CUSTOM_ASPECTS: AspectOption[] = [
  ...GPT_IMAGE_ASPECTS,
  { value: '9:16', label: '9 : 16', ratioW: 9, ratioH: 16, apiSize: '864x1536' },
  { value: '16:9', label: '16 : 9', ratioW: 16, ratioH: 9, apiSize: '1536x864' },
  { value: '4:3', label: '4 : 3', ratioW: 4, ratioH: 3, apiSize: '1536x1152' },
  { value: '3:4', label: '3 : 4', ratioW: 3, ratioH: 4, apiSize: '1152x1536' },
  { value: '21:9', label: '21 : 9', ratioW: 21, ratioH: 9, apiSize: '1792x768' },
];

export const DALLE3_ASPECTS: AspectOption[] = [
  { value: '1:1', label: '1 : 1', ratioW: 1, ratioH: 1, apiSize: '1024x1024' },
  { value: '7:4', label: '7 : 4', ratioW: 7, ratioH: 4, apiSize: '1792x1024' },
  { value: '4:7', label: '4 : 7', ratioW: 4, ratioH: 7, apiSize: '1024x1792' },
];

export const XAI_ASPECTS: AspectOption[] = [
  { value: '1:1', label: '1 : 1', ratioW: 1, ratioH: 1 },
  { value: '3:2', label: '3 : 2', ratioW: 3, ratioH: 2 },
  { value: '2:3', label: '2 : 3', ratioW: 2, ratioH: 3 },
  { value: '16:9', label: '16 : 9', ratioW: 16, ratioH: 9 },
  { value: '9:16', label: '9 : 16', ratioW: 9, ratioH: 16 },
  { value: '4:3', label: '4 : 3', ratioW: 4, ratioH: 3 },
  { value: '3:4', label: '3 : 4', ratioW: 3, ratioH: 4 },
  { value: '2:1', label: '2:1', ratioW: 2, ratioH: 1 },
  { value: '1:2', label: '1:2', ratioW: 1, ratioH: 2 },
  { value: '19.5:9', label: '19.5:9', ratioW: 19.5, ratioH: 9 },
  { value: '9:19.5', label: '9:19.5', ratioW: 9, ratioH: 19.5 },
  { value: '20:9', label: '20:9', ratioW: 20, ratioH: 9 },
  { value: '9:20', label: '9:20', ratioW: 9, ratioH: 20 },
  { value: '21:9', label: '21:9', ratioW: 21, ratioH: 9 },
  { value: '5:2', label: '5:2', ratioW: 5, ratioH: 2 },
];

export const GENERIC_IMAGE_ASPECTS: AspectOption[] = [
  { value: '1:1', label: '1 : 1', ratioW: 1, ratioH: 1 },
  { value: '16:9', label: '16 : 9', ratioW: 16, ratioH: 9 },
  { value: '9:16', label: '9 : 16', ratioW: 9, ratioH: 16 },
];

export const GEMINI_ASPECTS: AspectOption[] = [
  { value: '1:1', label: '1 : 1', ratioW: 1, ratioH: 1 },
  { value: '2:3', label: '2 : 3', ratioW: 2, ratioH: 3 },
  { value: '3:2', label: '3 : 2', ratioW: 3, ratioH: 2 },
  { value: '3:4', label: '3 : 4', ratioW: 3, ratioH: 4 },
  { value: '4:3', label: '4 : 3', ratioW: 4, ratioH: 3 },
  { value: '4:5', label: '4 : 5', ratioW: 4, ratioH: 5 },
  { value: '5:4', label: '5 : 4', ratioW: 5, ratioH: 4 },
  { value: '9:16', label: '9 : 16', ratioW: 9, ratioH: 16 },
  { value: '16:9', label: '16 : 9', ratioW: 16, ratioH: 9 },
  { value: '21:9', label: '21 : 9', ratioW: 21, ratioH: 9 },
];

export const ALL_ASPECTS = [...GEMINI_ASPECTS].sort(
  (a, b) => a.ratioW / a.ratioH - b.ratioW / b.ratioH,
);

export const DEFAULT_IMAGE_PARAMS: ImageParams = {
  aspect: 'auto',
  quality: 'auto',
  background: 'auto',
  outputFormat: 'png',
  count: 1,
};

export const OPENAI_IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high'];
export const IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp'];

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
  if (isGptImage(modelId)) {
    return {
      aspects: /(?:gpt|chatgpt)-image-2\.5/i.test(modelId)
        ? GPT_IMAGE_CUSTOM_ASPECTS
        : GPT_IMAGE_ASPECTS,
      backgrounds: [
        { value: 'opaque', label: '不透明' },
        { value: 'transparent', label: '透明底' },
      ],
      qualities: OPENAI_IMAGE_QUALITIES,
      outputFormats: IMAGE_OUTPUT_FORMATS,
      maxCount: 4,
      supportsEdit: true,
    };
  }

  if (isDallE(modelId)) {
    if (/dall-e-3/i.test(modelId)) {
      return {
        aspects: DALLE3_ASPECTS,
        qualities: ['standard', 'hd'],
        styles: ['vivid', 'natural'],
        maxCount: 1,
      };
    }
    return {
      aspects: [DALLE3_ASPECTS[0]],
      maxCount: 1,
      qualities: ['standard'],
      supportsEdit: /dall-e-2/i.test(modelId),
    };
  }

  return {
    aspects: GENERIC_IMAGE_ASPECTS,
    maxCount: 1,
  };
}

export function textCapabilitiesForOpenAI(modelId: string): ModelCapabilities {
  const id = modelId.toLowerCase();
  const vision =
    /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|chatgpt|(^|[-_/])o[134]([-_]|$)|vision|(^|[-_/])vl([-_]|$)|multimodal|omni|llava|pixtral|gemma-3|deepseek[-_]?vl)/.test(
      id,
    );
  const tools =
    /(gpt-4|gpt-5|gpt-3\.5|chatgpt|o1|o3|o4|claude|gemini|deepseek|qwen|llama|mistral|grok)/.test(
      id,
    ) && !/instruct|base|embedding/.test(id);
  return {
    vision,
    tools,
    imageGeneration: false,
  };
}

export function xaiImageCapabilities(_modelId: string): ImageCapabilities {
  return {
    aspects: XAI_ASPECTS,
    maxCount: 4,
    supportsEdit: false,
  };
}

export function googleImageCapabilities(modelId: string, displayName = ''): ImageCapabilities {
  if (/imagen/i.test(modelId)) {
    return {
      aspects: [
        ...GEMINI_ASPECTS,
        { value: '1:4', label: '1 : 4', ratioW: 1, ratioH: 4 },
        { value: '4:1', label: '4 : 1', ratioW: 4, ratioH: 1 },
      ],
      maxCount: 4,
      supportsEdit: false,
    };
  }

  const isGemini3Image = /gemini-3.*image/i.test(modelId);
  const banana = isNanoBanana(modelId, displayName);
  return {
    aspects: GEMINI_ASPECTS,
    maxCount: 1,
    supportsEdit: true,
    imageSizes: isGemini3Image || banana ? ['1K', '2K', '4K'] : undefined,
  };
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
  if (!capabilities) return params;
  const aspects = capabilities.aspects ?? GENERIC_IMAGE_ASPECTS;
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

  const outputFormat =
    capabilities.outputFormats && capabilities.outputFormats.length > 0
      ? capabilities.outputFormats.includes(params.outputFormat ?? '')
        ? params.outputFormat
        : capabilities.outputFormats[0]
      : undefined;

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
