import type {
  ChatRoundInput,
  ChatRoundResult,
  GenerateImageInput,
  GeneratedImage,
  ModelDescriptor,
  ProviderConfig,
  ProviderId,
} from '@/types';

export interface AdapterRequestOptions {
  useProxy: boolean;
}

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  defaultBaseUrl: string;
}

export interface ProviderAdapter {
  meta: ProviderMeta;
  listModels(config: ProviderConfig, options: AdapterRequestOptions): Promise<ModelDescriptor[]>;
  generateImage(
    config: ProviderConfig,
    model: ModelDescriptor,
    input: GenerateImageInput,
    options: AdapterRequestOptions,
  ): Promise<GeneratedImage[]>;
  streamChat(
    config: ProviderConfig,
    model: ModelDescriptor,
    input: ChatRoundInput,
    options: AdapterRequestOptions,
  ): Promise<ChatRoundResult>;
}

export class ProviderError extends Error {
  readonly status?: number;
  readonly provider?: ProviderId;
  readonly kind: 'network' | 'auth' | 'rate-limit' | 'request' | 'safety' | 'parse' | 'unknown';

  constructor(
    message: string,
    options: {
      status?: number;
      provider?: ProviderId;
      kind?: ProviderError['kind'];
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.status = options.status;
    this.provider = options.provider;
    this.kind = options.kind ?? 'unknown';
  }
}
