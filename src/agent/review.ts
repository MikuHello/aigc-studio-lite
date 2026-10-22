import promptReviewTemplate from '@/templates/prompt-review.liquid?raw';
import type { ChatImage, ModelDescriptor, ProviderConfig, ReviewSettings } from '@/types';
import { DEFAULT_REVIEW_SETTINGS } from '@/lib/reviewSettings';
import { renderTemplate } from '@/lib/templates';
import { getAdapter } from './runtime';
import { stripImageFences } from '@/providers/shared';

const REVIEW_SYSTEM_PROMPT = [
  '你是一名图像提示词安全编辑。',
  '你的任务是在不改变创作意图的前提下，改写可能触发图像模型内容审核的表述。',
  '你不是内容审查员，不要拒绝任务，也不要评判用户。',
  '只输出改写后的提示词正文。',
].join('\n');

export interface ReviewPromptOptions {
  prompt: string;
  textModel: ModelDescriptor;
  imageModel?: ModelDescriptor;
  config: ProviderConfig;
  useProxy: boolean;
  references?: ChatImage[];
  settings?: ReviewSettings;
  aspectRatio?: string;
  signal?: AbortSignal;
}

export interface ReviewPromptResult {
  prompt: string;
  changed: boolean;
}

function cleanReviewedPrompt(value: string): string {
  let cleaned = stripImageFences(value);
  cleaned = cleaned.replace(
    /^(?:润色后的?提示词|改写后的?提示词|安全改写后|提示词|输出)\s*[：:]\s*/i,
    '',
  );
  return cleaned.trim();
}

export async function reviewPrompt(options: ReviewPromptOptions): Promise<ReviewPromptResult> {
  const original = options.prompt.trim();
  if (!original) {
    throw new Error('提示词还是空的，没有可审查的内容。');
  }

  const settings = options.settings ?? DEFAULT_REVIEW_SETTINGS;
  const images = settings.useReferenceImages ? (options.references ?? []).slice(0, 6) : [];
  if (images.length && !options.textModel.capabilities.vision) {
    throw new Error('当前润色模型不支持识图，请选择支持识图的模型，或关闭「参考上传图片」。');
  }
  const userMessage = await renderTemplate(promptReviewTemplate, {
    prompt: original,
    target_model: options.imageModel?.label ?? '图像生成模型',
    aspect_ratio: options.aspectRatio ?? '模型默认',
    has_references: images.length > 0,
    rewrite_rules: settings.rules,
    pass_target_model: settings.passTargetModel,
    pass_aspect_ratio: settings.passAspectRatio,
  });

  const adapter = getAdapter(options.textModel.providerId);
  const result = await adapter.streamChat(
    options.config,
    options.textModel,
    {
      system: REVIEW_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage, ...(images.length ? { images } : {}) }],
      tools: [],
      continuations: [],
      signal: options.signal,
      onText: () => undefined,
    },
    { useProxy: options.useProxy },
  );

  const rewritten = cleanReviewedPrompt(result.text);
  if (!rewritten) {
    throw new Error('审查 Agent 没有返回可用的提示词。');
  }
  return {
    prompt: rewritten.slice(0, 16_000),
    changed: rewritten.trim() !== original,
  };
}

export { promptReviewTemplate as promptReviewTemplateSource };
