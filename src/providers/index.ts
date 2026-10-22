import type { ModelDescriptor, ProviderConfig, ProviderId } from '@/types';
import { anthropicAdapter } from './anthropic';
import { googleAdapter } from './google';
import { openaiAdapter } from './openai';
import { xaiAdapter } from './xai';
import type { ProviderAdapter } from './types';

export const adapters: Record<ProviderId, ProviderAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  google: googleAdapter,
  xai: xaiAdapter,
};

export function defaultProviderConfigs(): Record<ProviderId, ProviderConfig> {
  return {
    openai: {
      apiKey: '',
      baseUrl: openaiAdapter.meta.defaultBaseUrl,
      rememberKey: true,
    },
    anthropic: {
      apiKey: '',
      baseUrl: anthropicAdapter.meta.defaultBaseUrl,
      rememberKey: true,
    },
    google: {
      apiKey: '',
      baseUrl: googleAdapter.meta.defaultBaseUrl,
      rememberKey: true,
    },
    xai: {
      apiKey: '',
      baseUrl: xaiAdapter.meta.defaultBaseUrl,
      rememberKey: true,
    },
  };
}

export function getModel(
  models: ModelDescriptor[],
  key: string | null | undefined,
): ModelDescriptor | undefined {
  if (!key) return undefined;
  return models.find((model) => model.key === key);
}

export {
  DEFAULT_IMAGE_PARAMS,
  openAIImageCapabilities,
  googleImageCapabilities,
  xaiImageCapabilities,
  normalizeImageParams,
  isGrokImage,
  isNanoBanana,
} from './model-capabilities';
export type { ProviderAdapter } from './types';
export { ProviderError } from './types';
