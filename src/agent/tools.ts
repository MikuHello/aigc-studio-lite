import type { AgentToolDefinition, ModelDescriptor } from '@/types';

export function buildGenerateImageTool(
  imageModel: ModelDescriptor,
  hasReferenceImages: boolean,
): AgentToolDefinition {
  const imageCaps = imageModel.capabilities.image;
  const aspects = imageCaps?.aspects?.map((aspect) => aspect.value) ?? [];
  const backgrounds = imageCaps?.backgrounds?.map((background) => background.value) ?? [];

  const properties: Record<string, unknown> = {
    prompt: {
      type: 'string',
      description:
        '完整、具体的图像生成提示词。写清主体、场景、光线、构图、材质和氛围；除非用户要求，否则不要包含文字或水印。',
    },
  };

  if (aspects.length > 0) {
    properties.aspect_ratio = {
      type: 'string',
      enum: ['auto', ...aspects],
      description: `画幅比例，不指定或 auto 时由模型决定。当前图像引擎支持：${aspects.join('、')}。`,
    };
  }
  if (backgrounds.length > 0) {
    properties.background = {
      type: 'string',
      enum: ['auto', ...backgrounds.map((value) => value)],
      description: '背景模式。transparent 表示透明底，仅在用户明确需要时使用。',
    };
  }
  if (hasReferenceImages && imageCaps?.supportsEdit) {
    properties.use_uploaded_images = {
      type: 'boolean',
      description: '是否把用户本轮上传的参考图一起交给图像模型，用于风格参考、局部修改或图生图。',
    };
  }

  return {
    name: 'generate_image',
    description: [
      `使用当前图像引擎「${imageModel.label}」生成图片。`,
      imageCaps?.supportsEdit
        ? '该引擎支持参考图编辑。'
        : '该引擎不支持参考图编辑，参考图不会被传入。',
      '当用户要求生成、修改或延展图像时调用该工具。一次调用只生成一张，除非用户明确要求一组图。',
    ].join(''),
    parameters: {
      type: 'object',
      properties,
      required: ['prompt'],
    },
  };
}
