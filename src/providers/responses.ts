import type { ChatRoundInput, ChatRoundResult, ModelDescriptor, ProviderConfig } from '@/types';
import type { AdapterRequestOptions } from './types';
import { ProviderError } from './types';
import { isEventStream, joinUrl, parseJsonObject, providerFetch, readEventStream } from './shared';

type ResponseItem = Record<string, unknown> & {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type: string; text?: string; refusal?: string }[];
};
interface ResponsePayload {
  output?: ResponseItem[];
  status?: string;
  error?: { message?: string };
  incomplete_details?: { reason?: string };
}

function responseError(payload: ResponsePayload): Error | null {
  if (payload.error || payload.status === 'failed')
    return new ProviderError(payload.error?.message || 'Responses 请求失败。', {
      provider: 'openai',
      kind: 'request',
    });
  if (payload.status === 'incomplete')
    return new ProviderError(
      `Responses 输出未完成：${payload.incomplete_details?.reason || '请重试'}`,
      { provider: 'openai', kind: 'request' },
    );
  return null;
}

export async function streamResponses(
  config: ProviderConfig,
  model: ModelDescriptor,
  input: ChatRoundInput,
  options: AdapterRequestOptions,
): Promise<ChatRoundResult> {
  const items: unknown[] = input.messages.map((message) => ({
    role: message.role,
    content:
      message.role === 'user' && message.images?.length
        ? [
            { type: 'input_text', text: message.content || '请查看这些参考图片。' },
            ...message.images.map((image) => ({
              type: 'input_image',
              image_url: image.dataUrl,
              detail: 'auto',
            })),
          ]
        : message.content,
  }));
  for (const continuation of input.continuations) {
    const previous = continuation.assistant as { output?: ResponseItem[] } | undefined;
    items.push(...(previous?.output ?? []));
    items.push(
      ...continuation.results.map((result) => ({
        type: 'function_call_output',
        call_id: result.callId,
        output: result.content,
      })),
    );
  }
  const body = {
    model: model.modelId,
    instructions: input.system,
    input: items,
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    ...(input.tools.length
      ? {
          tools: input.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: false,
          })),
        }
      : {}),
  };
  const response = await providerFetch(
    joinUrl(config.baseUrl, 'responses'),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: input.signal,
    },
    { provider: 'openai', useProxy: options.useProxy, signal: input.signal },
  );
  let text = '';
  let output: ResponseItem[] = [];
  if (!isEventStream(response)) {
    const payload = (await response.json()) as ResponsePayload;
    const error = responseError(payload);
    if (error) throw error;
    output = payload.output ?? [];
  } else {
    const completedItems = new Map<number, ResponseItem>();
    let completed = false;
    let error: Error | null = null;
    await readEventStream(response, (data) => {
      let event: {
        type: string;
        delta?: string;
        output_index?: number;
        item?: ResponseItem;
        response?: ResponsePayload;
        message?: string;
      };
      try {
        event = JSON.parse(data);
      } catch {
        return;
      }
      if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
        const delta = event.delta ?? '';
        text += delta;
        if (delta) input.onText(delta);
      } else if (event.type === 'response.output_item.done' && event.item) {
        completedItems.set(event.output_index ?? completedItems.size, event.item);
      } else if (event.type === 'response.completed') {
        completed = true;
        output = event.response?.output ?? [];
        error = responseError(event.response ?? {});
      } else if (event.type === 'response.failed' || event.type === 'response.incomplete') {
        error = responseError(event.response ?? { status: event.type.split('.')[1] });
      } else if (event.type === 'error') {
        error = new ProviderError(event.message || 'Responses 流式响应出错。', {
          provider: 'openai',
          kind: 'request',
        });
      }
    });
    if (error) throw error;
    if (!completed)
      throw new ProviderError('Responses 连接提前结束，请重试。', {
        provider: 'openai',
        kind: 'network',
      });
    if (!output.length)
      output = [...completedItems.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
  }
  if (!text) {
    text = output
      .flatMap((item) =>
        item.type === 'message'
          ? (item.content ?? []).map((part) => part.text ?? part.refusal ?? '')
          : [],
      )
      .join('');
    if (text) input.onText(text);
  }
  const toolCalls = output
    .filter((item) => item.type === 'function_call')
    .map((item) => {
      return {
        id: item.call_id ?? '',
        name: item.name ?? '',
        arguments: parseJsonObject(item.arguments ?? '{}'),
      };
    });
  return { text, toolCalls, rawAssistant: { output } };
}
