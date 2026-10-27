import { describe, expect, it } from 'vitest';
import {
  imageModelCapabilities,
  imageModelOptions,
  findImageModelConfigId,
  configuredVideoModels,
} from '@/providers/model-config';
import { matchImageModelConfig, textModelCapabilities } from '@/providers/model-matching';
import { imageCapabilitiesFor, refreshModelCapabilities } from '@/providers/model-support';
import { customModel } from '@/lib/customModels';
import type { ProviderId } from '@/types';
import { readModelConfigFiles, validateModelConfigs } from '../scripts/model-config-validation.mjs';

const files = readModelConfigFiles();
const imagePath = 'image-models/openai/gpt-image-2.json';
const videoPath = 'video-models/volcengine/seedance-2.5.json';
const mappingPath = 'model-mappings/openai.json';

describe('model configuration validation', () => {
  it('accepts the shipped files without rewriting them', () => {
    const copy = structuredClone(files);
    expect(validateModelConfigs(copy)).toBe(copy);
    expect(copy).toEqual(files);
  });

  it.each([
    [
      'misspelled capability',
      (d: any) => {
        d[imagePath].maxReferencess = 9;
      },
      'additional properties',
    ],
    [
      'incorrect number type',
      (d: any) => {
        d[imagePath].maxImagesPerRequest = '4';
      },
      'integer',
    ],
    [
      'duplicate aspect ratio',
      (d: any) => {
        d[imagePath].aspectRatios.push('1:1');
      },
      'duplicate items',
    ],
    [
      'invalid aspect ratio',
      (d: any) => {
        d[imagePath].aspectRatios = ['0:9'];
      },
      'pattern',
    ],
    [
      'unsupported output format',
      (d: any) => {
        d[imagePath].outputFormats = ['gif'];
      },
      'allowed values',
    ],
    [
      'missing reference limit',
      (d: any) => {
        delete d[imagePath].maxReferenceImages;
      },
      'positive maxReferenceImages',
    ],
    [
      'inconsistent reference support',
      (d: any) => {
        d[imagePath].supportsReferenceImages = false;
      },
      'requires supportsReferenceImages',
    ],
    [
      'incomplete dimensions',
      (d: any) => {
        delete d[imagePath].imageDimensions['1:1'];
      },
      'cover every aspect ratio',
    ],
    [
      'dimensions for an unknown ratio',
      (d: any) => {
        d[imagePath].imageDimensions['99:1'] = { width: 100, height: 100 };
      },
      'unknown aspect ratio',
    ],
    [
      'reversed duration range',
      (d: any) => {
        d[videoPath].minDurationSeconds = 100;
      },
      'minDurationSeconds',
    ],
    [
      'unsupported video mode',
      (d: any) => {
        d[videoPath].modes = ['invalid-mode'];
      },
      'allowed values',
    ],
    [
      'missing adaptive ratio',
      (d: any) => {
        d[videoPath].aspectRatios = ['16:9'];
      },
      'adaptive frame ratio',
    ],
    [
      'mismatched config filename',
      (d: any) => {
        d[imagePath].configId = 'openai/different-model';
      },
      'file path',
    ],
    [
      'duplicate config ID',
      (d: any) => {
        d['image-models/openai/copy.json'] = structuredClone(d[imagePath]);
      },
      'duplicate configId',
    ],
    [
      'missing mapped config',
      (d: any) => {
        delete d[imagePath];
      },
      'unknown configId',
    ],
    [
      'wrong mapped type',
      (d: any) => {
        d[mappingPath].imageModels[0].configId = 'volcengine/seedance-2.5';
      },
      'wrong model type',
    ],
    [
      'wrong mapped provider',
      (d: any) => {
        d[mappingPath].imageModels[0].configId = 'google/gemini-3-pro-image';
      },
      'wrong provider',
    ],
    [
      'duplicate model ID',
      (d: any) => {
        d[mappingPath].imageModels[1].modelId = d[mappingPath].imageModels[0].modelId;
      },
      'duplicate modelId',
    ],
    [
      'unmapped config',
      (d: any) => {
        d[mappingPath].imageModels = d[mappingPath].imageModels.filter(
          (m: any) => m.configId !== 'openai/gpt-image-2',
        );
      },
      'no model mapping',
    ],
    [
      'connection details in model config',
      (d: any) => {
        d[imagePath].baseUrl = 'https://example.test';
      },
      'additional properties',
    ],
  ])('rejects %s', (_name, edit, message) => {
    const invalid = structuredClone(files);
    edit(invalid);
    expect(() => validateModelConfigs(invalid)).toThrow(message);
  });

  it('accepts a new model and alias without adding its name to a schema', () => {
    const copy = structuredClone(files);
    copy['image-models/openai/new-model.json'] = {
      ...structuredClone(copy[imagePath]),
      configId: 'openai/new-model',
      displayName: 'New model',
    };
    copy[mappingPath].imageModels.push({
      modelId: 'new-model-v1',
      configId: 'openai/new-model',
      selectable: true,
    });
    copy[mappingPath].imageModels.push({
      modelId: 'new-model-alias',
      configId: 'openai/new-model',
    });
    expect(() => validateModelConfigs(copy)).not.toThrow();
  });
});

describe('model configuration consumers', () => {
  it('resolves every selectable image specification and preserves existing profile IDs', () => {
    for (const [provider, choices] of Object.entries(imageModelOptions())) {
      for (const choice of choices) {
        expect(
          imageCapabilitiesFor(provider as ProviderId, choice.value).aspects?.length,
        ).toBeGreaterThan(0);
      }
    }
    expect(findImageModelConfigId('volcengine', 'doubao-seedream-4-0')).toBe(
      'volcengine/seedream-4.0',
    );
    expect(findImageModelConfigId('openai', 'gpt-image-1')).toBe(
      findImageModelConfigId('openai', 'gpt-image-1.5'),
    );
    expect(configuredVideoModels('volcengine')[0]).toMatchObject({
      modelId: 'doubao-seedance-2-5-260628',
      key: 'volcengine::doubao-seedance-2-5-260628',
      label: 'Seedance 2.5',
    });
  });

  it('preserves versioned model matching and conservative unknown-model behavior', () => {
    expect(matchImageModelConfig('google', 'gemini-2.5-flash-image-preview')).toBe(
      'google/gemini-2.5-flash-image',
    );
    expect(matchImageModelConfig('openai', 'chatgpt-image-2-latest')).toBe('openai/gpt-image-2');
    expect(matchImageModelConfig('volcengine', 'ep-custom')).toBeUndefined();
    expect(imageCapabilitiesFor('google', 'unrecognized-model')).toEqual({
      aspects: [],
      maxCount: 1,
      supportsEdit: false,
    });
  });

  it('keeps manual reference opt-out isolated from other models and shared config', () => {
    const manual = customModel({
      provider: 'google',
      id: 'my-image-alias',
      label: '',
      kind: 'image',
      vision: false,
      tools: false,
      references: false,
      imageProfile: 'gemini-3.1-flash-lite-image',
    });
    expect(refreshModelCapabilities(manual).capabilities.image?.supportsEdit).toBe(false);
    expect(imageCapabilitiesFor('google', 'gemini-3.1-flash-lite-image').supportsEdit).toBe(true);
    const copy = imageModelCapabilities('google/gemini-3.1-flash-lite-image');
    copy.aspects!.length = 0;
    copy.imageSizes!.push('4K');
    expect(imageModelCapabilities('google/gemini-3.1-flash-lite-image').imageSizes).toEqual(['1K']);
    expect(
      imageModelCapabilities('google/gemini-3.1-flash-lite-image').aspects!.length,
    ).toBeGreaterThan(0);
  });

  it('preserves provider-specific text discovery and exclusions', () => {
    expect(textModelCapabilities('google', 'gemini-test')).toMatchObject({
      vision: true,
      tools: true,
    });
    expect(textModelCapabilities('google', 'unknown')).toMatchObject({
      vision: false,
      tools: false,
    });
    expect(textModelCapabilities('anthropic', 'claude-test')).toMatchObject({
      vision: true,
      tools: true,
    });
    expect(textModelCapabilities('xai', 'GROK-4')).toMatchObject({ vision: true, tools: true });
    expect(textModelCapabilities('volcengine', 'doubao-seed-test')).toMatchObject({
      vision: true,
      tools: true,
    });
    expect(textModelCapabilities('openai', 'qwen-base')).toMatchObject({
      vision: false,
      tools: false,
    });
  });
});
