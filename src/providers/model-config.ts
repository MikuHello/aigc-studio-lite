import type {
  ImageCapabilities,
  ImageModelConfig,
  ModelDescriptor,
  Option,
  ProviderId,
  ProviderModelMappings,
  VideoCapabilities,
  VideoModelConfig,
} from '@/types';

const imageFiles = import.meta.glob<ImageModelConfig>('./model-configs/image-models/**/*.json', {
  eager: true,
  import: 'default',
});
const videoFiles = import.meta.glob<VideoModelConfig>('./model-configs/video-models/**/*.json', {
  eager: true,
  import: 'default',
});
const mappingFiles = import.meta.glob<ProviderModelMappings>(
  './model-configs/model-mappings/*.json',
  {
    eager: true,
    import: 'default',
  },
);

function indexConfigs<T extends { configId: string }>(files: Record<string, T>): Map<string, T> {
  const index = new Map<string, T>();
  for (const config of Object.values(files)) {
    if (index.has(config.configId)) throw new Error(`Duplicate model config: ${config.configId}`);
    index.set(config.configId, config);
  }
  return index;
}

const imageConfigs = indexConfigs(imageFiles);
const videoConfigs = indexConfigs(videoFiles);
const mappings = Object.values(mappingFiles);

function requireConfig<T>(configs: Map<string, T>, configId: string): T {
  const config = configs.get(configId);
  if (!config) throw new Error(`Unknown model config: ${configId}`);
  return config;
}

export function findImageModelConfigId(provider: ProviderId, modelId: string): string | undefined {
  return mappings
    .find((item) => item.providerId === provider)
    ?.imageModels.find((item) => item.modelId === modelId)?.configId;
}

export function imageModelCapabilities(configId: string): ImageCapabilities {
  const config = requireConfig(imageConfigs, configId);
  const aspects = config.aspectRatios.map((value) => {
    const [ratioW, ratioH] = value.split(':').map(Number);
    const size = config.imageDimensions?.[value];
    return {
      value,
      label: config.aspectRatioLabels?.[value] ?? value.replace(':', ' : '),
      ratioW,
      ratioH,
      ...(size ? { apiSize: `${size.width}x${size.height}` } : {}),
    };
  });
  const caps: ImageCapabilities = { aspects, maxCount: config.maxImagesPerRequest };
  if (config.backgrounds)
    caps.backgrounds = config.backgrounds.map((value) => ({
      value,
      label: value === 'transparent' ? '透明底' : '不透明',
    }));
  if (config.qualities) caps.qualities = config.qualities;
  if (config.styles) caps.styles = config.styles;
  if (config.outputFormats) caps.outputFormats = config.outputFormats;
  if (config.resolutions) caps.imageSizes = config.resolutions;
  if (config.supportsReferenceImages !== undefined)
    caps.supportsEdit = config.supportsReferenceImages;
  if (config.maxReferenceImages !== undefined) caps.maxReferences = config.maxReferenceImages;
  return structuredClone(caps);
}

export function imageModelOptions(): Partial<Record<ProviderId, Option[]>> {
  return Object.fromEntries(
    mappings
      .filter((mapping) => mapping.imageModels.some((model) => model.selectable))
      .map((mapping) => [
        mapping.providerId,
        mapping.imageModels
          .filter((model) => model.selectable)
          .map((model) => ({
            value: model.modelId,
            label: requireConfig(imageConfigs, model.configId).displayName,
          })),
      ]),
  );
}

function videoCapabilities(config: VideoModelConfig): VideoCapabilities {
  return {
    modes: config.modes,
    resolutions: config.resolutions,
    ratios: config.aspectRatios,
    minDuration: config.minDurationSeconds,
    maxDuration: config.maxDurationSeconds,
    autoDuration: config.supportsAutoDuration,
    audio: config.supportsAudio,
    adaptiveFrameRatio: config.requiresAdaptiveFrameRatio,
    ...(config.requiresAutoVideoReferenceParams ? { autoVideoReferenceParams: true } : {}),
    maxReferenceImages: config.maxReferenceImages,
    maxReferenceVideos: config.maxReferenceVideos,
    maxReferenceAudios: config.maxReferenceAudios,
    maxReferenceDurationSeconds: config.maxReferenceDurationSeconds,
    audioOnlyReference: config.supportsAudioOnlyReference,
  };
}

export function configuredVideoModels(provider: ProviderId): ModelDescriptor[] {
  return (mappings.find((mapping) => mapping.providerId === provider)?.videoModels ?? []).map(
    (model) => {
      const config = requireConfig(videoConfigs, model.configId);
      return {
        key: `${provider}::${model.modelId}`,
        providerId: provider,
        modelId: model.modelId,
        label: config.displayName,
        kind: 'video',
        capabilities: {
          vision: false,
          tools: false,
          imageGeneration: false,
          video: structuredClone(videoCapabilities(config)),
        },
      };
    },
  );
}
