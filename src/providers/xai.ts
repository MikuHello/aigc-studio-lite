import type { GenerateImageInput, GeneratedImage, ModelDescriptor, ProviderConfig } from '@/types';
import { isGrokImage, textCapabilitiesForOpenAI, xaiImageCapabilities } from './model-capabilities';
import { openaiAdapter } from './openai';
import { errorMessageFromPayload, joinUrl, providerFetch, providerJson } from './shared';
import type { AdapterRequestOptions, ProviderAdapter, ProviderMeta } from './types';
import { ProviderError } from './types';

const META: ProviderMeta = {
  id: 'xai',
  name: 'xAI',
  defaultBaseUrl: 'https://api.x.ai/v1',
};

const EXCLUDED_TEXT = /embedding|audio|tts|transcribe|moderation/i;

function headers(config: ProviderConfig): HeadersInit {
  return {
    Authorization: `Bearer ${config.apiKey.trim()}`,
    'Content-Type': 'application/json',
  };
}

function xaiImageMime(): string {
  return 'image/png';
}

interface XaiImagePayload {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  error?: { message?: string };
}

async function listModels(
  config: ProviderConfig,
  options: AdapterRequestOptions,
): Promise<ModelDescriptor[]> {
  const payload = await providerJson<{
    data?: Array<{ id?: string; owned_by?: string; created?: number }>;
  }>(
    joinUrl(config.baseUrl, 'models'),
    { method: 'GET', headers: headers(config) },
    { useProxy: options.useProxy, provider: 'xai' },
  );

  const models: ModelDescriptor[] = [];
  for (const item of payload.data ?? []) {
    const id = item.id?.trim();
    if (!id) continue;

    if (isGrokImage(id) || /imagine/i.test(id)) {
      const imageCaps = xaiImageCapabilities(id);
      models.push({
        key: `xai::${id}`,
        providerId: 'xai',
        modelId: id,
        label: id,
        kind: 'image',
        capabilities: {
          vision: false,
          tools: false,
          imageGeneration: true,
          imageEditing: false,
          image: imageCaps,
        },
      });
      continue;
    }

    if (EXCLUDED_TEXT.test(id)) continue;
    const capabilities = textCapabilitiesForOpenAI(id);
    models.push({
      key: `xai::${id}`,
      providerId: 'xai',
      modelId: id,
      label: id,
      kind: 'text',
      capabilities: {
        ...capabilities,
        vision: capabilities.vision || /grok-(3|4|vision)/i.test(id),
      },
    });
  }

  return models.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'image' ? -1 : 1;
    if (a.kind === 'image') {
      const rank = (model: ModelDescriptor) =>
        /imagine/i.test(model.modelId) ? 2 : /grok.*image/i.test(model.modelId) ? 1 : 0;
      return rank(b) - rank(a) || a.modelId.localeCompare(b.modelId);
    }
    return a.modelId.localeCompare(b.modelId);
  });
}

async function fetchUrlImage(url: string, signal?: AbortSignal): Promise<GeneratedImage> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    signal?.throwIfAborted();
    throw new ProviderError('图片已生成，但浏览器无法下载结果。', {
      provider: 'xai',
      kind: 'network',
      cause: error,
    });
  }
  if (!response.ok) {
    throw new ProviderError(`图片下载失败（${response.status}）。`, {
      provider: 'xai',
      kind: 'network',
    });
  }
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败。'));
    reader.readAsDataURL(blob);
  });
  return { dataUrl, mimeType: blob.type || 'image/png' };
}

async function generateImage(
  config: ProviderConfig,
  model: ModelDescriptor,
  input: GenerateImageInput,
  options: AdapterRequestOptions,
): Promise<GeneratedImage[]> {
  const caps = model.capabilities.image ?? {};
  const aspect = caps.aspects?.find((item) => item.value === input.params.aspect)?.value;
  const body: Record<string, unknown> = {
    model: model.modelId,
    prompt: input.prompt,
    n: Math.min(Math.max(1, input.params.count), caps.maxCount ?? 1),
    response_format: 'b64_json',
  };
  if (aspect) body.aspect_ratio = aspect;

  const response = await providerFetch(
    joinUrl(config.baseUrl, 'images/generations'),
    {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify(body),
      signal: input.signal,
    },
    { useProxy: options.useProxy, signal: input.signal, provider: 'xai' },
  );
  const payload = (await response.json()) as XaiImagePayload;
  if (payload.error) {
    throw new ProviderError(errorMessageFromPayload(payload, '图像生成失败。'), {
      provider: 'xai',
      kind: 'request',
    });
  }
  if (!payload.data?.length) {
    throw new ProviderError('模型没有返回图片。请检查提示词或模型权限。', {
      provider: 'xai',
      kind: 'parse',
    });
  }

  return Promise.all(
    payload.data.map(async (item) => {
      if (item.b64_json) {
        return {
          dataUrl: `data:${xaiImageMime()};base64,${item.b64_json}`,
          mimeType: xaiImageMime(),
          revisedPrompt: item.revised_prompt,
        };
      }
      if (item.url) {
        const image = await fetchUrlImage(item.url, input.signal);
        return { ...image, revisedPrompt: item.revised_prompt };
      }
      throw new ProviderError('模型返回了无法识别的图片数据。', {
        provider: 'xai',
        kind: 'parse',
      });
    }),
  );
}

export const xaiAdapter: ProviderAdapter = {
  meta: META,
  listModels,
  generateImage,
  streamChat: openaiAdapter.streamChat,
};
