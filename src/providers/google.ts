import type {
  AgentToolCall,
  ChatRoundInput,
  ChatRoundResult,
  GenerateImageInput,
  GeneratedImage,
  ModelDescriptor,
  ProviderConfig,
} from '@/types';
import { parseDataUrl } from '@/lib/image';
import { googleImageCapabilities } from './model-capabilities';
import {
  isEventStream,
  joinUrl,
  providerFetch,
  providerJson,
  readEventStream,
  errorMessageFromPayload,
} from './shared';
import type { AdapterRequestOptions, ProviderAdapter, ProviderMeta } from './types';
import { ProviderError } from './types';

const META: ProviderMeta = {
  id: 'google',
  name: 'Google AI Studio',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
};

function headers(config: ProviderConfig): HeadersInit {
  return {
    'x-goog-api-key': config.apiKey.trim(),
    'Content-Type': 'application/json',
  };
}

interface GooglePart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thoughtSignature?: string;
}

interface GoogleContent {
  role: 'user' | 'model';
  parts: GooglePart[];
}

interface GooglePayload {
  candidates?: Array<{
    content?: { parts?: GooglePart[]; role?: string };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  error?: { message?: string };
  usageMetadata?: unknown;
}

function normalizeModelId(modelId: string): string {
  return modelId.replace(/^models\//, '');
}

function isImageModel(id: string, methods: string[], displayName = ''): boolean {
  if (/embedding|embed-content/i.test(id)) return false;
  const label = `${id} ${displayName}`;
  if (/image|imagen|banana|nano[-_ ]?b/i.test(label)) {
    return methods.includes('generateContent') || methods.includes('predict');
  }
  return false;
}

function blockedMessage(payload: GooglePayload): string | null {
  const promptBlock = payload.promptFeedback?.blockReason;
  if (promptBlock) {
    return payload.promptFeedback?.blockReasonMessage
      ? `${promptBlock}：${payload.promptFeedback.blockReasonMessage}`
      : `请求被 Google 安全策略拦截（${promptBlock}）。请调整提示词后重试。`;
  }
  const finish = payload.candidates?.[0]?.finishReason;
  if (
    finish &&
    ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].includes(finish)
  ) {
    return `请求被 Google 安全策略拦截（${finish}）。请调整提示词后重试。`;
  }
  return null;
}

async function generateImage(
  config: ProviderConfig,
  model: ModelDescriptor,
  input: GenerateImageInput,
  options: AdapterRequestOptions,
): Promise<GeneratedImage[]> {
  const id = normalizeModelId(model.modelId);
  const caps = model.capabilities.image ?? {};
  const aspect = caps.aspects?.find((item) => item.value === input.params.aspect)?.value;

  if (/imagen/i.test(id)) {
    const parameters: Record<string, unknown> = {
      sampleCount: Math.min(input.params.count, caps.maxCount ?? 4),
    };
    if (aspect) parameters.aspectRatio = aspect;
    const payload = await providerJson<{
      predictions?: Array<{
        bytesBase64Encoded?: string;
        mimeType?: string;
        prompt?: string;
      }>;
      error?: { message?: string };
    }>(
      joinUrl(config.baseUrl, `models/${encodeURIComponent(id)}:predict`),
      {
        method: 'POST',
        headers: headers(config),
        body: JSON.stringify({
          instances: [{ prompt: input.prompt }],
          parameters,
        }),
        signal: input.signal,
      },
      { useProxy: options.useProxy, signal: input.signal, provider: 'google' },
    );

    const images = (payload.predictions ?? []).flatMap((prediction) => {
      if (!prediction.bytesBase64Encoded) return [];
      const mimeType = prediction.mimeType || 'image/png';
      return [
        {
          dataUrl: `data:${mimeType};base64,${prediction.bytesBase64Encoded}`,
          mimeType,
        },
      ];
    });
    if (images.length === 0) {
      throw new ProviderError(
        errorMessageFromPayload(payload, 'Imagen 没有返回图片。请检查提示词或权限。'),
        { provider: 'google', kind: 'safety' },
      );
    }
    return images;
  }

  const parts: GooglePart[] = [{ text: input.prompt }];
  if (caps.supportsEdit) {
    for (const reference of input.references) {
      const parsed = parseDataUrl(reference.dataUrl);
      parts.push({
        inlineData: { mimeType: parsed.mimeType, data: parsed.base64 },
      });
    }
  }

  const generationConfig: Record<string, unknown> = {
    responseModalities: ['TEXT', 'IMAGE'],
  };
  const imageConfig: Record<string, unknown> = {};
  if (aspect) imageConfig.aspectRatio = aspect;
  if (input.params.imageSize && caps.imageSizes?.includes(input.params.imageSize)) {
    imageConfig.imageSize = input.params.imageSize;
  }
  if (Object.keys(imageConfig).length > 0) generationConfig.imageConfig = imageConfig;

  const payload = await providerJson<GooglePayload>(
    joinUrl(config.baseUrl, `models/${encodeURIComponent(id)}:generateContent`),
    {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig,
      }),
      signal: input.signal,
    },
    { useProxy: options.useProxy, signal: input.signal, provider: 'google' },
  );

  const blocked = blockedMessage(payload);
  if (blocked) {
    throw new ProviderError(blocked, { provider: 'google', kind: 'safety' });
  }

  const images = (payload.candidates?.[0]?.content?.parts ?? []).flatMap((part) => {
    const inline = part.inlineData ?? part.inline_data;
    const data = part.inlineData?.data ?? part.inline_data?.data;
    if (!data) return [];
    const mimeType = part.inlineData?.mimeType ?? part.inline_data?.mime_type ?? 'image/png';
    void inline;
    return [{ dataUrl: `data:${mimeType};base64,${data}`, mimeType }];
  });

  if (images.length === 0) {
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .filter(Boolean)
      .join('\n');
    throw new ProviderError(
      text || 'Gemini 没有返回图片。请确认该模型支持图像输出，或尝试调整提示词。',
      { provider: 'google', kind: 'parse' },
    );
  }
  return images;
}

function toGoogleSchema(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const type = input.type;
  if (typeof type === 'string') output.type = type.toUpperCase();
  if (typeof input.description === 'string') output.description = input.description;
  if (Array.isArray(input.enum)) output.enum = input.enum;
  if (input.items && typeof input.items === 'object') {
    output.items = toGoogleSchema(input.items as Record<string, unknown>);
  }
  if (input.properties && typeof input.properties === 'object') {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input.properties as Record<string, unknown>)) {
      if (value && typeof value === 'object') {
        properties[key] = toGoogleSchema(value as Record<string, unknown>);
      }
    }
    output.properties = properties;
  }
  if (Array.isArray(input.required)) output.required = input.required;
  return output;
}

function buildContents(input: ChatRoundInput): GoogleContent[] {
  const contents: GoogleContent[] = [];
  const append = (role: GoogleContent['role'], parts: GooglePart[]) => {
    if (parts.length === 0) return;
    const last = contents[contents.length - 1];
    if (last?.role === role) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  };

  for (const message of input.messages) {
    if (message.role === 'assistant') {
      append('model', [{ text: message.content || ' ' }]);
      continue;
    }
    const parts: GooglePart[] = [];
    if (message.content) parts.push({ text: message.content });
    for (const image of message.images ?? []) {
      try {
        const parsed = parseDataUrl(image.dataUrl);
        parts.push({
          inlineData: { mimeType: parsed.mimeType, data: parsed.base64 },
        });
      } catch {}
    }
    append('user', parts.length ? parts : [{ text: '请继续。' }]);
  }

  for (const continuation of input.continuations) {
    const raw = continuation.assistant as { parts?: GooglePart[] } | undefined;
    if (raw?.parts?.length) append('model', raw.parts);
    append(
      'user',
      continuation.results.map((result) => ({
        functionResponse: {
          name: result.name,
          response: result.isError ? { error: result.content } : { result: result.content },
        },
      })),
    );
  }
  return contents;
}

function parseText(parts: GooglePart[] | undefined): string {
  return (parts ?? []).map((part) => part.text ?? '').join('');
}

function parseToolCalls(parts: GooglePart[] | undefined): AgentToolCall[] {
  return (parts ?? []).flatMap((part, index) => {
    if (!part.functionCall?.name) return [];
    return [
      {
        id: `google_call_${index}_${part.functionCall.name}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      },
    ];
  });
}

async function streamChat(
  config: ProviderConfig,
  model: ModelDescriptor,
  input: ChatRoundInput,
  options: AdapterRequestOptions,
): Promise<ChatRoundResult> {
  const id = normalizeModelId(model.modelId);
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: input.system }] },
    contents: buildContents(input),
    generationConfig: { maxOutputTokens: 8192 },
  };
  if (input.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: toGoogleSchema(tool.parameters),
        })),
      },
    ];
  }

  const url = joinUrl(
    config.baseUrl,
    `models/${encodeURIComponent(id)}:streamGenerateContent?alt=sse`,
  );
  const response = await providerFetch(
    url,
    {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify(body),
      signal: input.signal,
    },
    { useProxy: options.useProxy, signal: input.signal, provider: 'google' },
  );

  if (!isEventStream(response)) {
    const payload = (await response.json()) as GooglePayload;
    if (payload.error) {
      throw new ProviderError(errorMessageFromPayload(payload, '模型调用失败。'), {
        provider: 'google',
        kind: 'request',
      });
    }
    const blocked = blockedMessage(payload);
    if (blocked) throw new ProviderError(blocked, { provider: 'google', kind: 'safety' });
    const parts = payload.candidates?.[0]?.content?.parts;
    const text = parseText(parts);
    if (text) input.onText(text);
    return {
      text,
      toolCalls: parseToolCalls(parts),
      rawAssistant: { parts: parts ?? [] },
    };
  }

  let text = '';
  const toolParts: GooglePart[] = [];
  let streamError: Error | null = null;
  let blockedReason: string | null = null;

  await readEventStream(response, (data) => {
    let payload: GooglePayload;
    try {
      payload = JSON.parse(data) as GooglePayload;
    } catch {
      return;
    }
    if (payload.error) {
      streamError = new ProviderError(errorMessageFromPayload(payload, '模型流式响应出错。'), {
        provider: 'google',
        kind: 'request',
      });
      return;
    }
    const blocked = blockedMessage(payload);
    if (blocked) {
      blockedReason = blocked;
      return;
    }
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.text) {
        text += part.text;
        input.onText(part.text);
      }
      if (part.functionCall?.name) {
        toolParts.push(part);
      }
    }
  });

  if (streamError) throw streamError;
  if (blockedReason) throw new ProviderError(blockedReason, { provider: 'google', kind: 'safety' });

  const rebuiltParts: GooglePart[] = [];
  if (text) rebuiltParts.push({ text });
  rebuiltParts.push(...toolParts);

  return {
    text,
    toolCalls: parseToolCalls(toolParts),
    rawAssistant: { parts: rebuiltParts },
  };
}

async function listModels(
  config: ProviderConfig,
  options: AdapterRequestOptions,
): Promise<ModelDescriptor[]> {
  const models: ModelDescriptor[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({ pageSize: '1000' });
    if (pageToken) params.set('pageToken', pageToken);
    const payload = await providerJson<{
      models?: Array<{
        name?: string;
        displayName?: string;
        description?: string;
        supportedGenerationMethods?: string[];
      }>;
      nextPageToken?: string;
    }>(
      joinUrl(config.baseUrl, `models?${params.toString()}`),
      { method: 'GET', headers: headers(config) },
      { useProxy: options.useProxy, provider: 'google' },
    );

    for (const item of payload.models ?? []) {
      if (!item.name) continue;
      const id = normalizeModelId(item.name);
      const methods = item.supportedGenerationMethods ?? [];
      if (!methods.includes('generateContent') && !methods.includes('predict')) continue;
      if (/embedding|embed-content|aqa/i.test(id)) continue;

      if (isImageModel(id, methods, item.displayName)) {
        const imageCaps = googleImageCapabilities(id, item.displayName);
        models.push({
          key: `google::${id}`,
          providerId: 'google',
          modelId: id,
          label: item.displayName || id,
          kind: 'image',
          description: item.description,
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

      if (!methods.includes('generateContent')) continue;
      const isGemini = /gemini/i.test(id);
      models.push({
        key: `google::${id}`,
        providerId: 'google',
        modelId: id,
        label: item.displayName || id,
        kind: 'text',
        description: item.description,
        capabilities: {
          vision: isGemini,
          tools: isGemini,
          imageGeneration: false,
        },
      });
    }

    if (!payload.nextPageToken) break;
    pageToken = payload.nextPageToken;
  }

  return models.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'image' ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export const googleAdapter: ProviderAdapter = {
  meta: META,
  listModels,
  generateImage,
  streamChat,
};
