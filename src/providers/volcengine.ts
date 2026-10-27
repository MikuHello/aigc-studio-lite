import { prepareImageRequest, modelSupportReason, refreshModelCapabilities } from './model-support';
import { validateVideoInput } from '@/lib/video';
import type { GenerateVideoInput, ModelDescriptor, ProviderConfig, VideoTaskUpdate } from '@/types';
import type { AdapterRequestOptions, ProviderAdapter } from './types';
import { ProviderError } from './types';
import { joinUrl, providerJson } from './shared';
import { arkDiscoveredModel } from './ark-models';
import { openaiAdapter, imagesFromPayload } from './openai';

const TASK_PATH = '/contents/generations/tasks';

function request<T>(
  config: ProviderConfig,
  path: string,
  method: string,
  options: AdapterRequestOptions & { signal?: AbortSignal },
  body?: unknown,
) {
  if (!config.apiKey.trim())
    throw new ProviderError('请先配置火山方舟 API Key。', { kind: 'auth' });
  return providerJson<T>(
    joinUrl(config.baseUrl, path),
    {
      method,
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    { ...options, provider: 'volcengine' },
  );
}

export function videoRequestBody(model: ModelDescriptor, input: GenerateVideoInput) {
  model = refreshModelCapabilities(model);
  validateVideoInput(model, input);
  const p = input.params;
  const body = {
    model: model.modelId,
    content: [
      ...(input.prompt.trim() ? [{ type: 'text', text: input.prompt.trim() }] : []),
      ...input.references.map((item) => {
        const type =
          item.role === 'reference_video'
            ? 'video_url'
            : item.role === 'reference_audio'
              ? 'audio_url'
              : 'image_url';
        return { type, [type]: { url: item.dataUrl }, role: item.role };
      }),
    ],
    resolution: p.resolution,
    ratio: p.ratio,
    duration: p.duration,
    generate_audio: p.generateAudio,
    watermark: p.watermark,
  };
  if (new TextEncoder().encode(JSON.stringify(body)).length > 64 * 1024 * 1024)
    throw new Error('请求超过 64 MB，请减少或压缩参考素材后重试。');
  return body;
}

function safeMediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function parseVideoTask(payload: unknown): VideoTaskUpdate {
  if (!payload || typeof payload !== 'object')
    throw new ProviderError('视频任务响应无效。', { kind: 'parse' });
  const data = payload as Record<string, unknown>;
  const status = data.status;
  if (
    !['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired'].includes(status as string)
  )
    throw new ProviderError('服务返回了未知任务状态，请稍后重新查询。', { kind: 'parse' });
  const content = data.content as Record<string, unknown> | undefined;
  const url = safeMediaUrl(content?.video_url);
  const error = data.error as Record<string, unknown> | undefined;
  const created = data.created_at;
  const updated = data.updated_at;
  const elapsedMs =
    ['succeeded', 'failed', 'cancelled', 'expired'].includes(status as string) &&
    typeof created === 'number' &&
    typeof updated === 'number' &&
    Number.isFinite(created) &&
    Number.isFinite(updated) &&
    created > 0 &&
    updated >= created
      ? (updated - created) * 1000
      : undefined;
  return {
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
    status: status as VideoTaskUpdate['status'],
    ...(url
      ? {
          result: {
            url,
            lastFrameUrl: safeMediaUrl(content?.last_frame_url),
            duration: typeof data.duration === 'number' ? data.duration : undefined,
          },
        }
      : {}),
    error: typeof error?.message === 'string' ? error.message : undefined,
  };
}

export const volcengineAdapter: ProviderAdapter = {
  meta: {
    id: 'volcengine',
    name: '火山方舟',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  async listModels(config, options) {
    const data = await request<{ data?: Array<Record<string, unknown>> }>(
      config,
      '/models',
      'GET',
      options,
    );
    return (data.data ?? []).flatMap((item) => {
      const model = arkDiscoveredModel(item);
      return model &&
        !/embedding|rerank|tts|asr|audio|speech/i.test(
          [item.type, item.model_type, item.task_type, item.output_modalities].flat().join(' '),
        )
        ? [model]
        : [];
    });
  },
  async generateImage(config, model, input, options) {
    const prepared = prepareImageRequest(config, model, input);
    model = prepared.model;
    input = prepared.input;
    const aspect = model.capabilities.image?.aspects?.find(
      (item) => item.value === input.params.aspect,
    );
    const references = model.capabilities.image?.supportsEdit ? input.references : [];
    const payload = await request<{ data?: Array<{ b64_json?: string; url?: string }> }>(
      config,
      '/images/generations',
      'POST',
      { ...options, signal: input.signal },
      {
        model: model.modelId,
        prompt: input.prompt,
        response_format: 'b64_json',
        size: aspect?.apiSize ?? '2K',
        ...(references.length
          ? {
              image:
                references.length === 1
                  ? references[0].dataUrl
                  : references.map((image) => image.dataUrl),
            }
          : {}),
      },
    );
    return imagesFromPayload(payload, 'jpeg', input.signal);
  },
  streamChat(config, model, input, options) {
    return openaiAdapter.streamChat(
      { ...config, chatApi: 'chat-completions' },
      model,
      input,
      options,
    );
  },
  video: {
    async createVideo(config, model, input, options) {
      const reason = modelSupportReason(model, config);
      if (reason) throw new Error(reason);
      const data = await request<{ id?: string }>(
        config,
        TASK_PATH,
        'POST',
        options,
        videoRequestBody(model, input),
      );
      if (typeof data.id !== 'string' || !data.id.trim())
        throw new ProviderError(
          '服务未返回任务编号；请先在火山控制台确认是否已创建，避免重复提交。',
          { kind: 'parse' },
        );
      return data.id;
    },
    async queryVideo(config, taskId, options) {
      return parseVideoTask(
        await request(config, `${TASK_PATH}/${encodeURIComponent(taskId)}`, 'GET', options),
      );
    },
    async cancelVideo(config, taskId, options) {
      await request(config, `${TASK_PATH}/${encodeURIComponent(taskId)}`, 'DELETE', options);
    },
  },
};
