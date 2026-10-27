import type {
  ChatRoundInput,
  ChatRoundResult,
  GenerateImageInput,
  GeneratedImage,
  ModelDescriptor,
  ProviderConfig,
  ProviderId,
  GenerateVideoInput,
  VideoTaskUpdate,
} from '@/types';

export interface AdapterRequestOptions {
  signal?: AbortSignal;
  useProxy: boolean;
}

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  defaultBaseUrl: string;
}

export interface VideoAdapter {
  createVideo(
    config: ProviderConfig,
    model: ModelDescriptor,
    input: GenerateVideoInput,
    options: AdapterRequestOptions & { signal?: AbortSignal },
  ): Promise<string>;
  queryVideo(
    config: ProviderConfig,
    taskId: string,
    options: AdapterRequestOptions & { signal?: AbortSignal },
  ): Promise<VideoTaskUpdate>;
  cancelVideo?(
    config: ProviderConfig,
    taskId: string,
    options: AdapterRequestOptions & { signal?: AbortSignal },
  ): Promise<void>;
}

export interface ProviderAdapter {
  video?: VideoAdapter;
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
