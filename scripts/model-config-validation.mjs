import Ajv from 'ajv';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const configRoot = fileURLToPath(new URL('../src/providers/model-configs/', import.meta.url));
const ajv = new Ajv({ allErrors: true, strict: true });
const validators = Object.fromEntries(
  [
    ['image-models', 'image-model'],
    ['video-models', 'video-model'],
    ['model-mappings', 'model-mapping'],
  ].map(([directory, schema]) => [
    directory,
    ajv.compile(
      JSON.parse(readFileSync(join(configRoot, 'schemas', `${schema}.schema.json`), 'utf8')),
    ),
  ]),
);

export function readModelConfigFiles(root = configRoot) {
  const files = {};
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.json'))
        files[relative(root, path).replaceAll('\\', '/')] = JSON.parse(readFileSync(path, 'utf8'));
    }
  }
  for (const directory of Object.keys(validators)) visit(join(root, directory));
  return files;
}

export function validateModelConfigs(files) {
  const configs = new Map();
  const mappings = [];
  const fail = (path, message) => {
    throw new Error(`${path}: ${message}`);
  };
  for (const [path, config] of Object.entries(files)) {
    const directory = path.split('/')[0];
    const validate = validators[directory];
    if (!validate) fail(path, 'unknown configuration directory');
    if (!validate(config))
      fail(path, ajv.errorsText(validate.errors, { separator: '\n', dataVar: 'config' }));
    if (directory === 'model-mappings') {
      if (path !== `model-mappings/${config.providerId}.json`)
        fail(path, 'providerId must match the filename');
      mappings.push({ path, config });
      continue;
    }
    if (configs.has(config.configId)) fail(path, `duplicate configId: ${config.configId}`);
    if (path !== `${directory}/${config.configId}.json`)
      fail(path, 'configId must match the file path');
    configs.set(config.configId, { path, directory, config });
    if (directory === 'image-models') {
      if (config.supportsReferenceImages && !(config.maxReferenceImages > 0))
        fail(path, 'reference images require a positive maxReferenceImages');
      if (config.maxReferenceImages > 0 && !config.supportsReferenceImages)
        fail(path, 'maxReferenceImages requires supportsReferenceImages');
      for (const key of ['imageDimensions', 'aspectRatioLabels']) {
        for (const ratio of Object.keys(config[key] ?? {})) {
          if (!config.aspectRatios.includes(ratio))
            fail(path, `${key} contains unknown aspect ratio: ${ratio}`);
        }
      }
      if (
        config.imageDimensions &&
        config.aspectRatios.some((ratio) => !config.imageDimensions[ratio])
      )
        fail(path, 'imageDimensions must cover every aspect ratio');
    } else {
      if (config.minDurationSeconds > config.maxDurationSeconds)
        fail(path, 'minDurationSeconds exceeds maxDurationSeconds');
      if (config.requiresAdaptiveFrameRatio && !config.aspectRatios.includes('adaptive'))
        fail(path, 'adaptive frame ratio requires adaptive in aspectRatios');
    }
  }
  const referenced = new Set();
  for (const { path, config } of mappings) {
    const seen = new Set();
    for (const [key, directory] of [
      ['imageModels', 'image-models'],
      ['videoModels', 'video-models'],
    ]) {
      for (const model of config[key]) {
        if (seen.has(model.modelId)) fail(path, `duplicate modelId: ${model.modelId}`);
        seen.add(model.modelId);
        const target = configs.get(model.configId);
        if (!target) fail(path, `unknown configId: ${model.configId}`);
        if (target.directory !== directory) fail(path, `wrong model type for ${model.configId}`);
        if (!model.configId.startsWith(`${config.providerId}/`))
          fail(path, `wrong provider for ${model.configId}`);
        referenced.add(model.configId);
      }
    }
  }
  if (!configs.size || !mappings.length)
    fail('model-configs', 'model configurations and mappings must not be empty');
  for (const [configId, { path }] of configs) {
    if (!referenced.has(configId)) fail(path, 'configuration has no model mapping');
  }
  return files;
}
