import {
  remapVideoReferences,
  validateVideoInput,
  validateVideoImageBudget,
  validateReferenceMedia,
} from '@/lib/video';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { volcengineAdapter, parseVideoTask, videoRequestBody } from '@/providers/volcengine';
import {
  SEEDANCE_MODELS,
  VIDEO_DEFAULT_PARAMS,
  normalizeVideoParams,
} from '@/providers/video-capabilities';
import { customModel } from '@/lib/customModels';
import { normalizeBaseUrl } from '@/providers/shared';

const config = {
  apiKey: 'test-only',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  rememberKey: false,
};
const adapter = volcengineAdapter.video!;
const frame = { mimeType: 'image/png', dataUrl: 'data:image/png;base64,YQ==' };
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('Ark video protocol', () => {
  it('sends ordered first/last frames with 2.5 adaptive ratio and no obsolete seed or frame parameters', async () => {
    const fetch = vi.fn(async () => json({ id: 'cgt-test' }));
    vi.stubGlobal('fetch', fetch);
    const model = SEEDANCE_MODELS[0];
    const params = normalizeVideoParams(
      { ...VIDEO_DEFAULT_PARAMS, mode: 'first-last-frame', duration: 30 },
      model.capabilities.video!,
    );
    await expect(
      adapter.createVideo(
        config,
        model,
        {
          prompt: '镜头缓慢推进',
          params,
          references: [
            { ...frame, role: 'first_frame' },
            { ...frame, role: 'last_frame' },
          ],
        },
        { useProxy: true },
      ),
    ).resolves.toBe('cgt-test');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/proxy');
    expect(new Headers(init.headers).get('x-aigc-proxy-target')).toBe(
      `${config.baseUrl}/contents/generations/tasks`,
    );
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-only');
    expect(JSON.parse(init.body as string)).toEqual({
      model: model.modelId,
      content: [
        { type: 'text', text: '镜头缓慢推进' },
        { type: 'image_url', image_url: { url: frame.dataUrl }, role: 'first_frame' },
        { type: 'image_url', image_url: { url: frame.dataUrl }, role: 'last_frame' },
      ],
      resolution: '720p',
      ratio: 'adaptive',
      duration: 30,
      generate_audio: true,
      watermark: false,
    });
  });
  it('rejects unsupported parameters and missing tail frames before submitting', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      adapter.createVideo(
        config,
        SEEDANCE_MODELS[2],
        {
          prompt: 'test',
          params: { ...VIDEO_DEFAULT_PARAMS, resolution: '1080p' },
          references: [],
        },
        { useProxy: false },
      ),
    ).rejects.toThrow('参数');
    await expect(
      adapter.createVideo(
        config,
        SEEDANCE_MODELS[0],
        {
          prompt: 'test',
          params: { ...VIDEO_DEFAULT_PARAMS, mode: 'first-last-frame', ratio: 'adaptive' },
          references: [{ ...frame, role: 'first_frame' }],
        },
        { useProxy: false },
      ),
    ).rejects.toThrow('首帧和尾帧');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses DELETE on the encoded task endpoint for remote cancellation', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await adapter.cancelVideo!(config, 'cgt/a', { useProxy: false });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `${config.baseUrl}/contents/generations/tasks/cgt%2Fa`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
  it('queries only the task endpoint, preserves missing result status, and rejects unsafe media URLs', async () => {
    const fetch = vi.fn(async () =>
      json({ status: 'succeeded', content: { video_url: 'javascript:alert(1)' } }),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await adapter.queryVideo(config, 'cgt/a', { useProxy: false });
    expect(fetch.mock.calls[0][0]).toBe(`${config.baseUrl}/contents/generations/tasks/cgt%2Fa`);
    expect(result.status).toBe('succeeded');
    expect(result.result).toBeUndefined();
    expect(
      parseVideoTask({
        status: 'succeeded',
        content: { video_url: 'https://media.example/out.mp4' },
        duration: 8,
      }),
    ).toMatchObject({ result: { url: 'https://media.example/out.mp4', duration: 8 } });
    expect(() => parseVideoTask({ status: 'mystery' })).toThrow('未知');
    expect(parseVideoTask({ status: 'expired' }).status).toBe('expired');
  });
  it('supports explicit endpoint IDs without guessing their underlying model capability', () => {
    const input = {
      provider: 'volcengine' as const,
      id: 'ep-private',
      label: '',
      kind: 'video' as const,
      vision: false,
      tools: false,
      references: false,
    };
    expect(() => customModel(input)).toThrow('模型规格');
    const model = customModel({ ...input, videoProfile: SEEDANCE_MODELS[3].modelId });
    expect(model.modelId).toBe('ep-private');
    expect(model.capabilities.video?.maxDuration).toBe(15);
    expect(model.capabilities.video?.resolutions).not.toContain('1080p');
    expect(normalizeBaseUrl('https://ark.cn-beijing.volces.com', 'volcengine')).toBe(
      config.baseUrl,
    );
    expect(normalizeBaseUrl(`${config.baseUrl}/contents/generations/tasks`, 'volcengine')).toBe(
      config.baseUrl,
    );
  });
});

it('uses provider timestamps for final elapsed time, not video duration or local polling time', () => {
  const result = parseVideoTask({
    status: 'succeeded',
    created_at: 1000,
    updated_at: 1090,
    duration: 5,
    content: { video_url: 'https://media.example/out.mp4' },
  });
  expect(result.elapsedMs).toBe(90000);
  expect(result.result?.duration).toBe(5);
  expect(
    parseVideoTask({ status: 'running', created_at: 1000, updated_at: 1030 }).elapsedMs,
  ).toBeUndefined();
  expect(
    parseVideoTask({ status: 'failed', created_at: 1000, updated_at: 900 }).elapsedMs,
  ).toBeUndefined();
});

describe('multiple reference images', () => {
  it('sends ordered reference_image roles and preserves the 2.5 requested ratio', async () => {
    const fetch = vi.fn(async () => json({ id: 'cgt-reference' }));
    vi.stubGlobal('fetch', fetch);
    const model = SEEDANCE_MODELS[0];
    const params = normalizeVideoParams(
      { mode: 'reference', ratio: '9:16' },
      model.capabilities.video!,
    );
    const references = Array.from({ length: 30 }, (_, index) => ({
      ...frame,
      dataUrl: `data:image/png;base64,${index === 0 ? 'YQ==' : 'Yg=='}`,
      role: 'reference_image' as const,
    }));
    await adapter.createVideo(
      config,
      model,
      { prompt: '@图片1 是主体，@图片30 是场景', params, references },
      { useProxy: true },
    );
    const body = JSON.parse(
      (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.ratio).toBe('9:16');
    expect(body.content.slice(1)).toEqual(
      references.map((reference) => ({
        type: 'image_url',
        image_url: { url: reference.dataUrl },
        role: 'reference_image',
      })),
    );
    expect(() =>
      validateVideoInput(SEEDANCE_MODELS[1], { prompt: '', params, references }),
    ).toThrow('1–9');
    expect(() => validateVideoInput(model, { prompt: '@图片31', params, references })).toThrow(
      '不存在',
    );
    expect(() =>
      validateVideoInput(model, {
        prompt: '',
        params,
        references: [{ ...frame, role: 'first_frame' }],
      }),
    ).toThrow('不能混用');
  });
  it('tracks image identity when reordering and flags removed mentions', () => {
    expect(remapVideoReferences('@图片1 配合 @图片2', ['a', 'b'], ['b', 'a'])).toBe(
      '@图片2 配合 @图片1',
    );
    const prompt = remapVideoReferences('@图片1 配合 @图片2', ['a', 'b'], ['b']);
    expect(prompt).toBe('[已移除:图片1] 配合 @图片1');
    expect(remapVideoReferences(prompt, ['b'], [])).toBe('[已移除:图片1] 配合 [已移除:图片1]');
    expect(() =>
      validateVideoInput(SEEDANCE_MODELS[1], {
        prompt,
        params: { ...VIDEO_DEFAULT_PARAMS, mode: 'reference' },
        references: [{ ...frame, role: 'reference_image' }],
      }),
    ).toThrow('已移除');
  });
});

describe('omni references', () => {
  const video = {
    mimeType: 'video/mp4',
    dataUrl: 'https://example.com/motion.mp4',
    durationSeconds: 5,
    role: 'reference_video' as const,
  };
  const audio = {
    mimeType: 'audio/wav',
    dataUrl: 'data:audio/wav;base64,YQ==',
    durationSeconds: 3,
    role: 'reference_audio' as const,
  };
  const image = { ...frame, role: 'reference_image' as const };
  const params = { ...VIDEO_DEFAULT_PARAMS, mode: 'reference' as const };
  it('serializes mixed content with the correct fields and preserves per-kind input order', () => {
    const body = videoRequestBody(SEEDANCE_MODELS[0], {
      prompt: '@视频1 的运镜，@音频1 的节奏，@图片1 的主体',
      params: { ...params, ratio: 'adaptive', duration: -1 },
      references: [video, audio, image],
    });
    expect(body.content).toEqual([
      { type: 'text', text: '@视频1 的运镜，@音频1 的节奏，@图片1 的主体' },
      { type: 'video_url', video_url: { url: video.dataUrl }, role: 'reference_video' },
      { type: 'audio_url', audio_url: { url: audio.dataUrl }, role: 'reference_audio' },
      { type: 'image_url', image_url: { url: image.dataUrl }, role: 'reference_image' },
    ]);
  });
  it.each(['model', 'endpoint'])(
    'blocks incompatible automatic video tasks before HTTP for a %s, including stale capabilities',
    async (kind) => {
      const model =
        kind === 'model'
          ? structuredClone(SEEDANCE_MODELS[0])
          : customModel({
              provider: 'volcengine',
              id: 'ep-test',
              label: '',
              kind: 'video',
              vision: false,
              tools: false,
              references: false,
              videoProfile: SEEDANCE_MODELS[0].modelId,
            });
      delete model.capabilities.video!.autoVideoReferenceParams;
      const fetch = vi.fn(async () => json({ id: 'cgt-auto' }));
      vi.stubGlobal('fetch', fetch);
      const submit = (ratio: string, duration: number, durationSeconds = 5) =>
        adapter.createVideo(
          config,
          model,
          {
            prompt: '替换 @视频1 中的主体',
            params: { ...params, ratio, duration },
            references: [{ ...video, durationSeconds }],
          },
          { useProxy: false },
        );
      await expect(submit('16:9', 5)).rejects.toThrow('画幅设为自动');
      await expect(submit('adaptive', 5)).rejects.toThrow('时长设为自动');
      await expect(submit('16:9', -1)).rejects.toThrow('画幅设为自动');
      await expect(submit('adaptive', -1, 3)).rejects.toThrow('4–30');
      expect(fetch).not.toHaveBeenCalled();
      await expect(submit('adaptive', -1, 4)).resolves.toBe('cgt-auto');
      const body = JSON.parse(
        (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
      );
      expect(body).toMatchObject({ model: model.modelId, ratio: 'adaptive', duration: -1 });
      expect(body).not.toHaveProperty('omni_reference_task_type');
    },
  );
  it('rejects short automatic-task video references when adding them but preserves the audio and older-model limits', () => {
    const newer = SEEDANCE_MODELS.find(
      (model) => model.capabilities.video?.autoVideoReferenceParams,
    )!.capabilities.video!;
    const older = SEEDANCE_MODELS.find(
      (model) => !model.capabilities.video?.autoVideoReferenceParams,
    )!.capabilities.video!;
    expect(() => validateReferenceMedia(newer, [{ ...video, durationSeconds: 3 }], false)).toThrow(
      '4–30',
    );
    expect(() =>
      validateReferenceMedia(newer, [{ ...video, durationSeconds: 4 }], false),
    ).not.toThrow();
    expect(() =>
      validateReferenceMedia(newer, [{ ...audio, durationSeconds: 2 }], false),
    ).not.toThrow();
    expect(() =>
      validateReferenceMedia(older, [{ ...video, durationSeconds: 2 }], false),
    ).not.toThrow();
  });
  it('accepts audio-only on 2.5 but requires visual input on 2.0', () => {
    expect(() =>
      validateVideoInput(SEEDANCE_MODELS[0], { prompt: '', params, references: [audio] }),
    ).not.toThrow();
    expect(() =>
      validateVideoInput(SEEDANCE_MODELS[1], { prompt: '', params, references: [audio] }),
    ).toThrow('至少搭配');
    expect(() =>
      validateVideoInput(SEEDANCE_MODELS[1], { prompt: '', params, references: [audio, video] }),
    ).not.toThrow();
  });
  it('enforces per-kind limits, duration totals, valid URLs, and mention bounds', () => {
    const check = (references: Array<typeof video | typeof audio>, prompt = '') =>
      validateVideoInput(SEEDANCE_MODELS[1], { prompt, params, references });
    expect(() =>
      check([
        { ...video, durationSeconds: 8 },
        { ...video, durationSeconds: 8 },
      ]),
    ).toThrow('总时长');
    expect(() =>
      check([video, ...Array.from({ length: 4 }, () => ({ ...audio, durationSeconds: 2 }))]),
    ).toThrow('3 段');
    expect(() => check([{ ...video, durationSeconds: NaN }])).toThrow('单段时长');
    expect(() => check([{ ...video, dataUrl: 'data:video/mp4;base64,YQ==' }])).toThrow('HTTPS');
    expect(() => check([{ ...video, dataUrl: 'javascript:alert(1)' }])).toThrow('HTTPS');
    expect(() => check([video, audio], '@音频2')).toThrow('不存在');
    expect(() => check([{ ...video, dataUrl: 'asset://asset-existing' }])).not.toThrow();
    expect(() => validateVideoImageBudget(['x'.repeat(64 * 1024 * 1024)])).toThrow('64 MB');
  });
  it('remaps each media type independently and flags deleted audio references', () => {
    const assets = Object.fromEntries(
      [
        ['v', video],
        ['a', audio],
        ['b', audio],
        ['i', image],
      ].map(([id, item]) => [id, { id, mimeType: (item as typeof audio).mimeType }]),
    ) as unknown as Record<string, import('@/types').Asset>;
    expect(
      remapVideoReferences(
        '@视频1 @音频1 @音频2 @图片1',
        ['v', 'a', 'b', 'i'],
        ['b', 'i', 'v'],
        assets,
      ),
    ).toBe('@视频1 [已移除:音频1] @音频1 @图片1');
  });
});

describe('Seedance UI parameter contracts', () => {
  it.each(SEEDANCE_MODELS.map((m) => [m.label, m] as const))(
    '%s sends every offered resolution and duration boundary',
    (_label, model) => {
      const caps = model.capabilities.video!;
      for (const resolution of caps.resolutions) {
        for (const duration of [-1, caps.minDuration, caps.maxDuration]) {
          const params = normalizeVideoParams({ mode: 'text', resolution, duration }, caps);
          expect(videoRequestBody(model, { prompt: 'cat', params, references: [] })).toMatchObject({
            resolution,
            duration,
            generate_audio: true,
          });
        }
      }
      expect(() =>
        videoRequestBody(model, {
          prompt: 'cat',
          params: { ...normalizeVideoParams({}, caps), duration: caps.maxDuration + 1 },
          references: [],
        }),
      ).toThrow('参数');
    },
  );
});
