import { afterEach, describe, expect, it, vi } from 'vitest';
import { volcengineAdapter } from '@/providers/volcengine';
import { customModel, suggestCustomModel } from '@/lib/customModels';
const config = {
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  apiKey: 'test-only',
  rememberKey: false,
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());
describe('Ark multi-modal supplier', () => {
  it('preserves text/image/video discovery, respects declared type and does not assign unknown video specs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          data: [
            { id: 'doubao-seed-2-0-pro' },
            { id: 'doubao-seedream-4-0' },
            { id: 'doubao-seedance-2-5-260628' },
            { id: 'ep-custom', output_modalities: ['image'] },
            { id: 'unknown-video', type: 'video' },
            { id: 'custom-model' },
          ],
        }),
      ),
    );
    const models = await volcengineAdapter.listModels(config, { useProxy: false });
    expect(models.map((m) => m.kind)).toEqual(['text', 'image', 'video', 'image', 'video', 'text']);
    expect(models.every((m) => m.providerId === 'volcengine')).toBe(true);
    expect(models[2].capabilities.video).toBeDefined();
    expect(models[4].capabilities.video).toBeUndefined();
  });
  it('allows manual text and image endpoints without hard-wiring video', () => {
    for (const kind of ['text', 'image'] as const)
      expect(
        customModel({
          provider: 'volcengine',
          id: 'ep-custom',
          label: 'Custom',
          kind,
          vision: true,
          tools: true,
          references: true,
        }).kind,
      ).toBe(kind);
    expect(suggestCustomModel('volcengine', 'doubao-seedream-4-0')).toMatchObject({
      kind: 'image',
      references: true,
    });
    expect(suggestCustomModel('volcengine', 'ep-custom').kind).toBe('text');
    expect(() =>
      customModel({
        provider: 'volcengine',
        id: 'ep-video',
        label: '',
        kind: 'video',
        vision: false,
        tools: false,
        references: false,
      }),
    ).toThrow('模型规格');
  });
  it('sends image references as JSON to images/generations and reads base64 results', async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      json({ data: [{ b64_json: 'YQ==' }] }),
    );
    vi.stubGlobal('fetch', fetch);
    const model = customModel({
      provider: 'volcengine',
      id: 'ep-image',
      imageProfile: 'doubao-seedream-4-0',
      label: '',
      kind: 'image',
      vision: false,
      tools: false,
      references: true,
    });
    const result = await volcengineAdapter.generateImage(
      config,
      model,
      {
        prompt: 'test',
        params: { aspect: '16:9', count: 1 },
        references: [{ dataUrl: 'data:image/png;base64,Yg==', mimeType: 'image/png' }],
      },
      { useProxy: false },
    );
    expect(String(fetch.mock.calls[0][0])).toContain('/api/v3/images/generations');
    const request = fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      model: 'ep-image',
      image: 'data:image/png;base64,Yg==',
      size: '2848x1600',
      response_format: 'b64_json',
    });
    expect(result[0].dataUrl).toBe('data:image/jpeg;base64,YQ==');
  });
  it('routes manual text models through chat completions', async () => {
    const fetch = vi.fn(async () =>
      json({ choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }] }),
    );
    vi.stubGlobal('fetch', fetch);
    const model = customModel({
      provider: 'volcengine',
      id: 'ep-text',
      label: '',
      kind: 'text',
      vision: false,
      tools: false,
      references: false,
    });
    await volcengineAdapter.streamChat(
      config,
      model,
      { system: '', messages: [], tools: [], continuations: [], onText: () => {} },
      { useProxy: false },
    );
    expect(String(fetch.mock.calls[0][0])).toContain('/api/v3/chat/completions');
  });
});
