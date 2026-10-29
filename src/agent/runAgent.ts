import { modelConnection } from '@/lib/connections';
import { MAX_IMAGE_ATTACHMENTS } from '@/lib/referencePolicy';
import agentSystemTemplate from '@/templates/agent-system.liquid?raw';
import type {
  AgentActivity,
  AgentHistoryMessage,
  AgentToolCall,
  AgentToolContinuation,
  AgentToolResult,
  GeneratedImage,
  ImageParams,
  ImageReference,
  ModelDescriptor,
  ProviderConfigs,
} from '@/types';
import { renderTemplate } from '@/lib/templates';
import { createId } from '@/lib/id';
import { normalizeImageParams } from '@/providers/model-capabilities';
import { getAdapter } from './runtime';
import { buildGenerateImageTool } from './tools';

export interface AgentGeneratedMeta {
  prompt: string;
  originalPrompt: string;
  reviewed: boolean;
  model: ModelDescriptor;
  params: ImageParams;
}

export interface AgentRunOptions {
  textModel: ModelDescriptor;
  imageModel?: ModelDescriptor;
  configs: ProviderConfigs;
  history: AgentHistoryMessage[];
  userPrompt: string;
  userImages: ImageReference[];
  signal?: AbortSignal;
  callbacks: {
    onText: (chunk: string) => void;
    onActivity: (activity: AgentActivity) => void;
    onActivityPatch: (activityId: string, patch: Partial<AgentActivity>) => void;
    onGeneratedImages: (images: GeneratedImage[], meta: AgentGeneratedMeta) => Promise<void> | void;
  };
}

export interface AgentRunResult {
  text: string;
  generatedCount: number;
}

const MAX_ROUNDS = 4;
const MAX_IMAGE_CALLS = 4;

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanArg(value: unknown): boolean {
  return value === true || value === 'true';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

function createToolResult(call: AgentToolCall, content: string, isError = false): AgentToolResult {
  return { callId: call.id, name: call.name, content, isError };
}

async function executeImageTool(
  call: AgentToolCall,
  options: AgentRunOptions,
  imageCallsUsed: number,
): Promise<{ result: AgentToolResult; generatedCount: number; activities: AgentActivity[] }> {
  const activities: AgentActivity[] = [];
  const pushActivity = (label: string): AgentActivity => {
    const activity: AgentActivity = {
      id: createId('activity'),
      label,
      status: 'running',
    };
    activities.push(activity);
    options.callbacks.onActivity(activity);
    return activity;
  };
  const patchActivity = (activity: AgentActivity, patch: Partial<AgentActivity>) => {
    options.callbacks.onActivityPatch(activity.id, patch);
  };

  if (call.name !== 'generate_image') {
    return {
      result: createToolResult(call, `未知工具：${call.name}`, true),
      generatedCount: 0,
      activities,
    };
  }

  if (!options.imageModel) {
    return {
      result: createToolResult(
        call,
        '当前没有接入图像模型。请告诉用户在「模型接入」中连接 OpenAI 或 Google 的图像模型。',
        true,
      ),
      generatedCount: 0,
      activities,
    };
  }

  if (imageCallsUsed >= MAX_IMAGE_CALLS) {
    return {
      result: createToolResult(call, '本轮图像生成次数已达上限，请基于已有结果回复用户。', true),
      generatedCount: 0,
      activities,
    };
  }

  const imageModel = options.imageModel;
  const imageCaps = imageModel.capabilities.image;
  const prompt = stringArg(call.arguments.prompt);
  if (!prompt) {
    return {
      result: createToolResult(call, '缺少 prompt 参数。请补全具体的图像提示词。', true),
      generatedCount: 0,
      activities,
    };
  }

  const requestedAspect = stringArg(call.arguments.aspect_ratio);
  const requestedBackground = stringArg(call.arguments.background);
  const aspect =
    imageCaps?.aspects?.find((item) => item.value === requestedAspect)?.value ?? 'auto';
  const qualities = imageCaps?.qualities ?? [];
  const formats = imageCaps?.outputFormats ?? [];
  const imageSizes = imageCaps?.imageSizes ?? [];
  const params: ImageParams = normalizeImageParams(
    {
      aspect,
      background: requestedBackground === 'transparent' ? 'transparent' : requestedBackground,
      quality: qualities.includes('auto') ? 'auto' : qualities[0],
      outputFormat: formats.includes('png') ? 'png' : formats[0],
      imageSize: imageSizes[0],
      count: 1,
    },
    imageCaps,
  );

  const wantsReferences = booleanArg(call.arguments.use_uploaded_images);
  const references =
    wantsReferences && imageCaps?.supportsEdit && options.userImages.length > 0
      ? options.userImages.slice(0, MAX_IMAGE_ATTACHMENTS)
      : [];

  const generationActivity = pushActivity(
    `生成图像 · ${imageModel.label}${params.aspect ? ` · ${params.aspect}` : ''}`,
  );

  const adapter = getAdapter(imageModel.providerId);
  try {
    const imageConfig = modelConnection(options.configs, imageModel);
    const images = await adapter.generateImage(
      imageConfig,
      imageModel,
      {
        prompt,
        params,
        references,
        signal: options.signal,
      },
      { useProxy: imageConfig.useWorkerProxy === true },
    );

    options.signal?.throwIfAborted();
    await options.callbacks.onGeneratedImages(images, {
      prompt,
      originalPrompt: prompt,
      reviewed: false,
      model: imageModel,
      params,
    });
    patchActivity(generationActivity, {
      status: 'done',
      label: `已生成 ${images.length} 张图像`,
    });

    return {
      result: createToolResult(
        call,
        [
          `已成功生成 ${images.length} 张图像，并加入当前会话与图库。`,
          '请直接用一两句话向用户说明结果，不要再次调用同一提示词。',
        ]
          .filter(Boolean)
          .join(' '),
      ),
      generatedCount: images.length,
      activities,
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    const message = errorMessage(error);
    patchActivity(generationActivity, {
      status: 'error',
      label: '图像生成失败',
      detail: message,
    });
    return {
      result: createToolResult(
        call,
        `图像生成失败：${message}。如果问题来自提示词审核，可以改写提示词后再试一次；如果是配置或额度问题，请向用户说明。`,
        true,
      ),
      generatedCount: 0,
      activities,
    };
  }
}

export async function runAgentTurn(options: AgentRunOptions): Promise<AgentRunResult> {
  const imageCaps = options.imageModel?.capabilities.image;
  const system = await renderTemplate(agentSystemTemplate, {
    image_model: options.textModel.capabilities.tools ? (options.imageModel?.label ?? null) : null,
    aspect_ratios: imageCaps?.aspects?.map((aspect) => aspect.value) ?? [],
    supports_reference_images: Boolean(imageCaps?.supportsEdit),
    supports_transparency: Boolean(
      imageCaps?.backgrounds?.some((background) => background.value === 'transparent'),
    ),
    current_date: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' }).format(new Date()),
  });

  const tools =
    options.textModel.capabilities.tools && options.imageModel
      ? [buildGenerateImageTool(options.imageModel, options.userImages.length > 0)]
      : [];

  const history: AgentHistoryMessage[] = [
    ...options.history.map((message) =>
      options.textModel.capabilities.vision
        ? message
        : { role: message.role, content: message.content },
    ),
    {
      role: 'user',
      content: options.userPrompt,
      images: options.userImages.map((image) => ({
        mimeType: image.mimeType,
        dataUrl: image.dataUrl,
      })),
    },
  ];

  const adapter = getAdapter(options.textModel.providerId);
  const textConfig = modelConnection(options.configs, options.textModel);
  const continuations: AgentToolContinuation[] = [];
  let accumulatedText = '';
  let generatedCount = 0;
  let imageCallsUsed = 0;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let firstChunkOfRound = true;
    let toolCalls: AgentToolCall[] = [];

    const result = await adapter.streamChat(
      textConfig,
      options.textModel,
      {
        system,
        messages: history,
        tools,
        continuations,
        signal: options.signal,
        onText: (chunk) => {
          if (!chunk) return;
          if (round > 0 && firstChunkOfRound && accumulatedText.trim()) {
            accumulatedText += '\n\n';
            options.callbacks.onText('\n\n');
          }
          firstChunkOfRound = false;
          accumulatedText += chunk;
          options.callbacks.onText(chunk);
        },
      },
      { useProxy: textConfig.useWorkerProxy === true },
    );

    toolCalls = result.toolCalls;
    if (toolCalls.length === 0) {
      break;
    }

    if (round === MAX_ROUNDS - 1) {
      break;
    }

    const toolResults: AgentToolResult[] = [];
    for (const call of toolCalls) {
      if (call.name === 'generate_image') imageCallsUsed += 1;
      const execution = await executeImageTool(call, options, imageCallsUsed - 1);
      generatedCount += execution.generatedCount;
      toolResults.push(execution.result);
    }

    continuations.push({
      assistant: result.rawAssistant,
      results: toolResults,
    });
  }

  return { text: accumulatedText.trim(), generatedCount };
}
