import {
  prepareImageRequest,
  modelSupportReason,
  imageCapabilityId,
  assertChatSupport,
} from './model-support';
import type {
  ChatRoundInput,
  ChatRoundResult,
  GenerateImageInput,
  GeneratedImage,
  ModelDescriptor,
  ProviderConfig,
} from '@/types';
import { streamResponses } from './responses';
import { dataUrlToBlob } from '@/lib/image';
import {
  openAIImageCapabilities,
  textCapabilitiesForOpenAI,
  isDallE,
  isGptImage,
} from './model-capabilities';
import {
  isEventStream,
  joinUrl,
  providerFetch,
  providerJson,
  readEventStream,
  errorMessageFromPayload,
  parseJsonObject,
} from './shared';
import type { AdapterRequestOptions, ProviderAdapter, ProviderMeta } from './types';
import { ProviderError } from './types';

const META: ProviderMeta = {
  id: 'openai',
  name: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com/v1',
};

const EXCLUDED_TEXT_MODEL =
  /embedding|tts|whisper|transcribe|moderation|davinci|babbage|curie|(^|[/_-])ada([/_-]|$)|audio|realtime|image|video|sora|veo|seedance|rerank/i;
const IMAGE_MODEL =
  /gpt-image|chatgpt-image|dall-e|imagen|flux|seedream|stable-diffusion|sdxl|ideogram|recraft|nano-banana|qwen-image|grok-image/i;

function headers(config: ProviderConfig): HeadersInit {
  return {
    Authorization: `Bearer ${config.apiKey.trim()}`,
    'Content-Type': 'application/json',
  };
}

function imageMime(format: string | undefined): string {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}

interface OpenAIImagePayload {
  data?: Array<{
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
  }>;
  error?: { message?: string };
}

function inlineImagesFromPayload(
  payload: OpenAIImagePayload,
  outputFormat: string | undefined,
): GeneratedImage[] {
  return (payload.data ?? []).flatMap((item) => {
    if (!item.b64_json) return [];
    return [
      {
        dataUrl: `data:${imageMime(outputFormat)};base64,${item.b64_json}`,
        mimeType: imageMime(outputFormat),
        revisedPrompt: item.revised_prompt,
      },
    ];
  });
}

async function fetchUrlImages(
  payload: OpenAIImagePayload,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  const items = (payload.data ?? []).filter((item) => !item.b64_json && item.url);
  return Promise.all(
    items.map(async (item) => {
      let imageResponse: Response;
      try {
        imageResponse = await fetch(item.url as string, { signal });
      } catch (error) {
        signal?.throwIfAborted();
        throw new ProviderError('图片已生成，但浏览器无法下载结果。请改用 Worker 代理模式。', {
          provider: 'openai',
          kind: 'network',
          cause: error,
        });
      }
      if (!imageResponse.ok) {
        throw new ProviderError(`图片下载失败（${imageResponse.status}）。`, {
          provider: 'openai',
          kind: 'network',
        });
      }
      const blob = await imageResponse.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('图片读取失败。'));
        reader.readAsDataURL(blob);
      });
      return {
        dataUrl,
        mimeType: blob.type || 'image/png',
        revisedPrompt: item.revised_prompt,
      };
    }),
  );
}

export async function imagesFromPayload(
  payload: OpenAIImagePayload,
  outputFormat: string | undefined,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  if (!payload.data?.length) {
    throw new ProviderError('模型没有返回图片。请检查提示词或模型权限。', {
      provider: 'openai',
      kind: 'parse',
    });
  }
  const inline = inlineImagesFromPayload(payload, outputFormat);
  if (inline.length > 0) return inline;
  return fetchUrlImages(payload, signal);
}

function buildTools(input: ChatRoundInput) {
  if (input.tools.length === 0) return undefined;
  return input.tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function buildMessages(input: ChatRoundInput) {
  const messages: Record<string, unknown>[] = [{ role: 'system', content: input.system }];
  for (const message of input.messages) {
    if (message.role === 'assistant') {
      messages.push({ role: 'assistant', content: message.content });
      continue;
    }
    if (message.images?.length) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: message.content || '请查看这些参考图片。' },
          ...message.images.map((image) => ({
            type: 'image_url',
            image_url: { url: image.dataUrl, detail: 'auto' },
          })),
        ],
      });
    } else {
      messages.push({ role: 'user', content: message.content });
    }
  }

  for (const continuation of input.continuations) {
    const raw = continuation.assistant as
      { content?: string | null; tool_calls?: Record<string, unknown>[] } | undefined;
    messages.push({
      role: 'assistant',
      content: raw?.content ?? null,
      tool_calls: raw?.tool_calls ?? [],
    });
    for (const result of continuation.results) {
      messages.push({
        role: 'tool',
        tool_call_id: result.callId,
        content: result.content,
      });
    }
  }
  return messages;
}

function makeRawToolCalls(
  calls: Map<number, { id: string; name: string; arguments: string }>,
): { id: string; type: 'function'; function: { name: string; arguments: string } }[] {
  return [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => ({
      id: call.id,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments || '{}' },
    }));
}

function toToolCalls(raw: ReturnType<typeof makeRawToolCalls>) {
  return raw.map((call) => ({
    id: call.id,
    name: call.function.name,
    arguments: parseJsonObject(call.function.arguments),
  }));
}

async function generateImage(
  config: ProviderConfig,
  model: ModelDescriptor,
  input: GenerateImageInput,
  options: AdapterRequestOptions,
): Promise<GeneratedImage[]> {
  const prepared = prepareImageRequest(config, model, input);
  model = prepared.model;
  input = prepared.input;
  const caps = prepared.caps;
  const aspect = caps.aspects?.find((item) => item.value === input.params.aspect);
  const references = input.references;
  const imageProfile = imageCapabilityId(model);
  const canEdit = Boolean(caps.supportsEdit && references.length > 0);
  const format = isGptImage(imageProfile) ? (input.params.outputFormat ?? 'png') : undefined;

  if (canEdit) {
    const form = new FormData();
    form.set('model', model.modelId);
    form.set('prompt', input.prompt);
    form.set('n', String(input.params.count));
    if (input.params.aspect === 'auto' && isGptImage(imageProfile)) form.set('size', 'auto');
    else if (aspect?.apiSize) form.set('size', aspect.apiSize);
    if (isGptImage(imageProfile) && input.params.quality) form.set('quality', input.params.quality);
    if (format) form.set('output_format', format);
    if (input.params.background && isGptImage(imageProfile))
      form.set('background', input.params.background);
    if (input.params.background === 'transparent' && isGptImage(imageProfile)) {
      form.set('background', 'transparent');
      form.set('output_format', format === 'webp' ? 'webp' : 'png');
    }
    if (isDallE(imageProfile)) form.set('response_format', 'b64_json');

    references.forEach((reference, index) => {
      const blob = dataUrlToBlob(reference.dataUrl);
      const fieldName = isDallE(imageProfile) ? 'image' : 'image[]';
      form.append(fieldName, blob, reference.name || `reference-${index + 1}.png`);
    });

    const response = await providerFetch(
      joinUrl(config.baseUrl, 'images/edits'),
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
        body: form,
        signal: input.signal,
      },
      { useProxy: options.useProxy, signal: input.signal, provider: 'openai' },
    );
    const payload = (await response.json()) as OpenAIImagePayload;
    if (payload.error) {
      throw new ProviderError(errorMessageFromPayload(payload, '图像编辑失败。'), {
        provider: 'openai',
        kind: 'request',
      });
    }
    return imagesFromPayload(payload, format, input.signal);
  }

  const body: Record<string, unknown> = {
    model: model.modelId,
    prompt: input.prompt,
    n: input.params.count,
  };
  if (input.params.aspect === 'auto' && isGptImage(imageProfile)) body.size = 'auto';
  else if (aspect?.apiSize) body.size = aspect.apiSize;
  if (isGptImage(imageProfile)) {
    if (input.params.quality) body.quality = input.params.quality;
    if (format) body.output_format = format;
    if (input.params.background === 'transparent') {
      body.background = 'transparent';
      body.output_format = format === 'webp' ? 'webp' : 'png';
    } else if (input.params.background) {
      body.background = input.params.background;
    }
  } else if (isDallE(imageProfile)) {
    body.response_format = 'b64_json';
    if (input.params.quality) body.quality = input.params.quality;
    if (input.params.style) body.style = input.params.style;
  } else if (input.params.quality) {
    body.quality = input.params.quality;
  }

  const response = await providerFetch(
    joinUrl(config.baseUrl, 'images/generations'),
    {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify(body),
      signal: input.signal,
    },
    { useProxy: options.useProxy, signal: input.signal, provider: 'openai' },
  );
  const payload = (await response.json()) as OpenAIImagePayload;
  if (payload.error) {
    throw new ProviderError(errorMessageFromPayload(payload, '图像生成失败。'), {
      provider: 'openai',
      kind: 'request',
    });
  }
  return imagesFromPayload(payload, format, input.signal);
}

interface OpenAISseChunk {
  error?: { message?: string };
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

type ChatProtocol = 'chat-completions' | 'responses';
const detectedProtocols = new Map<string, ChatProtocol>();

async function streamChat(
  config: ProviderConfig,
  model: ModelDescriptor,
  input: ChatRoundInput,
  options: AdapterRequestOptions,
): Promise<ChatRoundResult> {
  assertChatSupport(config, model, input);
  const key = JSON.stringify([config.baseUrl, model.modelId, options.useProxy]);
  const continuation = input.continuations[0]?.assistant;
  const pinned = continuation
    ? Array.isArray((continuation as { output?: unknown }).output)
      ? 'responses'
      : 'chat-completions'
    : undefined;
  const explicit = config.chatApi && config.chatApi !== 'auto' ? config.chatApi : undefined;
  const first: ChatProtocol =
    pinned ?? explicit ?? detectedProtocols.get(key) ?? 'chat-completions';
  const run = (protocol: ChatProtocol) =>
    protocol === 'responses'
      ? streamResponses(config, model, input, options)
      : streamChatCompletions(config, model, input, options);
  try {
    const result = await run(first);
    if (!explicit) detectedProtocols.set(key, first);
    return result;
  } catch (error) {
    // @compat Retry only rejected endpoints; replaying a stream or tool continuation can duplicate work.
    const incompatible =
      error instanceof ProviderError &&
      ([404, 405, 501].includes(error.status ?? 0) ||
        (error.status === 400 &&
          /(?:not supported|unsupported|not available|不支持)/i.test(error.message) &&
          /(?:chat.?completions|responses|endpoint|接口)/i.test(error.message)));
    if (pinned || explicit || !incompatible || input.signal?.aborted) throw error;
    const alternative = first === 'responses' ? 'chat-completions' : 'responses';
    const result = await run(alternative);
    detectedProtocols.set(key, alternative);
    return result;
  }
}

function checkFinishReason(reason: string | null | undefined): void {
  if (reason === 'length' || reason === 'content_filter') {
    throw new ProviderError(
      reason === 'length'
        ? '模型输出达到长度限制，请重试。'
        : '模型输出被内容过滤中断，请调整请求后重试。',
      { provider: 'openai', kind: 'request' },
    );
  }
}

async function streamChatCompletions(
  config: ProviderConfig,
  model: ModelDescriptor,
  input: ChatRoundInput,
  options: AdapterRequestOptions,
): Promise<ChatRoundResult> {
  const tools = buildTools(input);
  const body: Record<string, unknown> = {
    model: model.modelId,
    messages: buildMessages(input),
    stream: true,
  };
  if (tools) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const response = await providerFetch(
    joinUrl(config.baseUrl, 'chat/completions'),
    {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify(body),
      signal: input.signal,
    },
    { useProxy: options.useProxy, signal: input.signal, provider: 'openai' },
  );

  if (!isEventStream(response)) {
    const payload = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string | null;
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
      error?: { message?: string };
    };
    if (payload.error) {
      throw new ProviderError(errorMessageFromPayload(payload, '模型调用失败。'), {
        provider: 'openai',
        kind: 'request',
      });
    }
    checkFinishReason(payload.choices?.[0]?.finish_reason);
    const message = payload.choices?.[0]?.message;
    const rawToolCalls = (message?.tool_calls ?? []).map((call, index) => ({
      id: call.id || `call_${index}`,
      type: 'function' as const,
      function: {
        name: call.function?.name ?? '',
        arguments: call.function?.arguments ?? '{}',
      },
    }));
    const text = message?.content ?? '';
    if (text) input.onText(text);
    return {
      text,
      toolCalls: toToolCalls(rawToolCalls),
      rawAssistant: { content: text || null, tool_calls: rawToolCalls },
    };
  }

  let text = '';
  const toolAccumulator = new Map<number, { id: string; name: string; arguments: string }>();
  let streamError: Error | null = null;
  let finished = false;

  const receivedDone = await readEventStream(response, (data) => {
    let chunk: OpenAISseChunk;
    try {
      chunk = JSON.parse(data) as OpenAISseChunk;
    } catch {
      return;
    }
    if (chunk.error) {
      streamError = new ProviderError(chunk.error.message || '模型流式响应出错。', {
        provider: 'openai',
        kind: 'request',
      });
      return;
    }
    const choice = chunk.choices?.[0];
    checkFinishReason(choice?.finish_reason);
    if (['stop', 'tool_calls', 'function_call'].includes(choice?.finish_reason ?? '')) {
      finished = true;
    }
    const delta = choice?.delta;
    if (!delta) return;
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content;
      input.onText(delta.content);
    }
    for (const call of delta.tool_calls ?? []) {
      const current = toolAccumulator.get(call.index) ?? { id: '', name: '', arguments: '' };
      if (call.id) current.id = call.id;
      if (call.function?.name) current.name += call.function.name;
      if (call.function?.arguments) current.arguments += call.function.arguments;
      toolAccumulator.set(call.index, current);
    }
  });

  if (streamError) throw streamError;
  if (toolAccumulator.size && !finished && !receivedDone) {
    throw new ProviderError('工具调用响应提前结束，请重试。', {
      provider: 'openai',
      kind: 'network',
    });
  }

  const rawToolCalls = makeRawToolCalls(toolAccumulator);
  return {
    text,
    toolCalls: toToolCalls(rawToolCalls),
    rawAssistant: {
      content: text || null,
      tool_calls: rawToolCalls,
    },
  };
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
    { useProxy: options.useProxy, signal: options.signal, provider: 'openai' },
  );

  const models: ModelDescriptor[] = [];
  for (const item of payload.data ?? []) {
    const id = item.id?.trim();
    if (!id) continue;

    if (IMAGE_MODEL.test(id)) {
      const imageCaps = openAIImageCapabilities(id);
      models.push({
        key: `openai::${id}`,
        providerId: 'openai',
        modelId: id,
        label: id,
        kind: 'image',
        capabilities: {
          vision: false,
          tools: false,
          imageGeneration: true,
          imageEditing: Boolean(imageCaps.supportsEdit),
          image: imageCaps,
        },
      });
      continue;
    }

    if (EXCLUDED_TEXT_MODEL.test(id)) continue;
    if (/^ft:/.test(id)) continue;

    models.push({
      key: `openai::${id}`,
      providerId: 'openai',
      modelId: id,
      label: id,
      kind: 'text',
      capabilities: textCapabilitiesForOpenAI(id),
    });
  }

  const imageRank = (id: string) => {
    if (/gpt-image-1(?!-mini)/.test(id)) return 100;
    if (/gpt-image/.test(id)) return 90;
    if (/dall-e-3/.test(id)) return 60;
    if (/dall-e/.test(id)) return 40;
    return 50;
  };
  return models
    .filter((model) => !modelSupportReason(model, config))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'image' ? -1 : 1;
      if (a.kind === 'image') {
        const rank = imageRank(b.modelId) - imageRank(a.modelId);
        if (rank !== 0) return rank;
      }
      return a.modelId.localeCompare(b.modelId);
    });
}

export const openaiAdapter: ProviderAdapter = {
  meta: META,
  listModels,
  generateImage,
  streamChat,
};
