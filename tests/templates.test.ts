import { describe, expect, it } from 'vitest';
import { renderTemplate } from '@/lib/templates';
import promptReviewTemplate from '@/templates/prompt-review.liquid?raw';
import agentSystemTemplate from '@/templates/agent-system.liquid?raw';
import { stripMarkdown, markdownPreview } from '@/lib/text';

describe('Jinja-style prompt templates', () => {
  it('renders conditionals and loops for the agent system prompt', async () => {
    const rendered = await renderTemplate(agentSystemTemplate, {
      image_model: 'gpt-image-1',
      aspect_ratios: ['1:1', '3:2', '2:3'],
      supports_reference_images: true,
      supports_transparency: true,
      current_date: '2026-10-20',
    });
    expect(rendered).not.toContain('工作区');
    expect(rendered).toContain('gpt-image-1');
    expect(rendered).toContain('1:1');
    expect(rendered).toContain('3:2');
    expect(rendered).toContain('支持参考图：是');
    expect(rendered).toContain('支持透明底：是');
    expect(rendered).not.toContain('未接入（只能进行文字工作');
  });

  it('renders the review template without executing user content as a template', async () => {
    const rendered = await renderTemplate(promptReviewTemplate, {
      target_model: 'gpt-image-1',
      aspect_ratio: '3:2',
      prompt: 'A {{ malicious }} thing with {{ other }}',
      has_references: true,
    });
    expect(rendered).toContain('A {{ malicious }} thing with {{ other }}');
    expect(rendered).toContain('目标模型：gpt-image-1');
    expect(rendered).toContain('已附上用户上传的参考图');
  });

  it('falls back gracefully when optional variables are absent', async () => {
    const rendered = await renderTemplate(agentSystemTemplate, {
      image_model: '',
      aspect_ratios: [],
      current_date: 'today',
    });
    expect(rendered).toContain('未接入');
    expect(rendered).not.toContain('可用画幅：');
  });
});

describe('markdown preview helpers', () => {
  it('removes structural Markdown markers for compact previews', () => {
    expect(stripMarkdown('## 画面\n\n**主体**：一只鸟\n- 光线：柔和')).toBe(
      '画面 主体：一只鸟 光线：柔和',
    );
    expect(markdownPreview('```js\nconst x = 1;\n```', 100)).toContain('const x = 1;');
  });
});
