import type {
  ChatRoundInput,
  ChatRoundResult,
  GenerateImageInput,
  GeneratedImage,
  ModelDescriptor,
  ProviderConfig,
} from '@/types';
import { parseDataUrl } from '@/lib/image';
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
  id: 'anthropic',
  name: 'Anthropic',
  defaultBaseUrl: 'https://api.anthropic.com/v1',
};

const ANTHROPIC_VERSION = '2023-06-01';

function headers(config: ProviderConfig): HeadersInit {
  return {
    'x-api-key': config.apiKey.trim(),
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
    'Content-Type': 'application/json',
  };
}

type AnthropicBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicBlock[];
}

function buildMessages(input: ChatRoundInput): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];

  const append = (role: AnthropicMessage['role'], blocks: AnthropicBlock[]) => {
    if (blocks.length === 0) return;
    const last = messages[messages.length - 1];
    if (last?.role === role) {
      last.content.push(...blocks);
    } else {
      messages.push({ role, content: blocks });
    }
  };

  for (const message of input.messages) {
    if (message.role === 'assistant') {
      append('assistant', [{ type: 'text', text: message.content || ' ' }]);
      continue;
    }
    const blocks: AnthropicBlock[] = [];
    if (message.content) blocks.push({ type: 'text', text: message.content });
    for (const image of message.images ?? []) {
      try {
        const parsed = parseDataUrl(image.dataUrl);
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: parsed.mimeType,
            data: parsed.base64,
          },
        });
      } catch {}
    }
    if (blocks.length === 0) blocks.push({ type: 'text', text: '请继续。' });
    append('user', blocks);
  }

  for (const continuation of input.continuations) {
    const raw = continuation.assistant as { content?: AnthropicBlock[] } | undefined;
    if (raw?.content?.length) append('assistant', raw.content);
    append(
      'user',
      continuation.results.map((result) => ({
        type: 'tool_result' as const,
        tool_use_id: result.callId,
        content: result.content,
        is_error: result.isError || undefined,
      })),
    );
  }

  return messages;
}

function buildTools(input: ChatRoundInput) {
  return input.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

function textFromBlocks(blocks: AnthropicBlock[]): string {
  return blocks
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function toolCallsFromBlocks(blocks: AnthropicBlock[]) {
  return blocks
    .filter(
      (
        block,
      ): block is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        block.type === 'tool_use',
    )
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments: block.input ?? {},
    }));
}

async function streamChat(
  config: ProviderConfig,
  model: ModelDescriptor,
  input: ChatRoundInput,
  options: AdapterRequestOptions,
): Promise<ChatRoundResult> {
  const body: Record<string, unknown> = {
    model: model.modelId,
    max_tokens: 8192,
    system: input.system,
    messages: buildMessages(input),
    stream: true,
  };
  if (input.tools.length > 0) {
    body.tools = buildTools(input);
  }

  const response = await providerFetch(
    joinUrl(config.baseUrl, 'messages'),
    {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify(body),
      signal: input.signal,
    },
    { useProxy: options.useProxy, signal: input.signal, provider: 'anthropic' },
  );

  if (!isEventStream(response)) {
    const payload = (await response.json()) as {
      content?: AnthropicBlock[];
      error?: { message?: string };
    };
    if (payload.error) {
      throw new ProviderError(errorMessageFromPayload(payload, '模型调用失败。'), {
        provider: 'anthropic',
        kind: 'request',
      });
    }
    const blocks = payload.content ?? [];
    const text = textFromBlocks(blocks);
    if (text) input.onText(text);
    return {
      text,
      toolCalls: toolCallsFromBlocks(blocks),
      rawAssistant: { content: blocks },
    };
  }

  const blocks = new Map<
    number,
    | { type: 'text'; text: string }
    | {
        type: 'tool_use';
        id: string;
        name: string;
        input: Record<string, unknown>;
        partial: string;
      }
  >();
  let text = '';
  let streamError: Error | null = null;

  await readEventStream(response, (data) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = event.type;
    if (type === 'error') {
      streamError = new ProviderError(errorMessageFromPayload(event, '模型流式响应出错。'), {
        provider: 'anthropic',
        kind: 'request',
      });
      return;
    }
    if (type === 'content_block_start') {
      const index = Number(event.index);
      const block = event.content_block as Record<string, unknown> | undefined;
      if (block?.type === 'text') {
        blocks.set(index, { type: 'text', text: String(block.text ?? '') });
      } else if (block?.type === 'tool_use') {
        blocks.set(index, {
          type: 'tool_use',
          id: String(block.id ?? `tool_${index}`),
          name: String(block.name ?? ''),
          input:
            block.input && typeof block.input === 'object'
              ? (block.input as Record<string, unknown>)
              : {},
          partial: '',
        });
      }
      return;
    }
    if (type === 'content_block_delta') {
      const index = Number(event.index);
      const delta = event.delta as Record<string, unknown> | undefined;
      const block = blocks.get(index);
      if (!block || !delta) return;
      if (block.type === 'text' && delta.type === 'text_delta') {
        const chunk = String(delta.text ?? '');
        if (chunk) {
          block.text += chunk;
          text += chunk;
          input.onText(chunk);
        }
      }
      if (block.type === 'tool_use' && delta.type === 'input_json_delta') {
        block.partial += String(delta.partial_json ?? '');
      }
    }
  });

  if (streamError) throw streamError;

  const content: AnthropicBlock[] = [];
  for (const [, block] of [...blocks.entries()].sort(([a], [b]) => a - b)) {
    if (block.type === 'text') {
      if (block.text) content.push(block);
    } else {
      let parsedInput = block.input;
      if (block.partial) {
        try {
          const parsed = JSON.parse(block.partial) as unknown;
          if (parsed && typeof parsed === 'object') {
            parsedInput = parsed as Record<string, unknown>;
          }
        } catch {
          parsedInput = {};
        }
      }
      content.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: parsedInput,
      });
    }
  }

  return {
    text,
    toolCalls: toolCallsFromBlocks(content),
    rawAssistant: { content },
  };
}

async function listModels(
  config: ProviderConfig,
  options: AdapterRequestOptions,
): Promise<ModelDescriptor[]> {
  const models: ModelDescriptor[] = [];
  let afterId: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({ limit: '1000' });
    if (afterId) params.set('after_id', afterId);
    const payload = await providerJson<{
      data?: Array<{ id?: string; display_name?: string; created_at?: string }>;
      has_more?: boolean;
      last_id?: string;
    }>(
      joinUrl(config.baseUrl, `models?${params.toString()}`),
      { method: 'GET', headers: headers(config) },
      { useProxy: options.useProxy, provider: 'anthropic' },
    );

    for (const item of payload.data ?? []) {
      if (!item.id) continue;
      models.push({
        key: `anthropic::${item.id}`,
        providerId: 'anthropic',
        modelId: item.id,
        label: item.display_name || item.id,
        kind: 'text',
        capabilities: {
          vision: true,
          tools: true,
          imageGeneration: false,
        },
      });
    }
    if (!payload.has_more || !payload.last_id) break;
    afterId = payload.last_id;
  }
  return models;
}

async function generateImage(
  _config: ProviderConfig,
  _model: ModelDescriptor,
  _input: GenerateImageInput,
  _options: AdapterRequestOptions,
): Promise<GeneratedImage[]> {
  throw new ProviderError(
    'Anthropic 端点当前不提供原生图像生成。请接入 OpenAI 或 Google 的图像模型。',
    { provider: 'anthropic', kind: 'request' },
  );
}

export const anthropicAdapter: ProviderAdapter = {
  meta: META,
  listModels,
  generateImage,
  streamChat,
};
