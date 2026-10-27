import { readModelConfigFiles, validateModelConfigs } from './model-config-validation.mjs';

try {
  validateModelConfigs(readModelConfigFiles());
  console.log('Model configurations and mappings are valid.');
} catch (error) {
  console.error(`Model configuration validation failed:\n${error.message}`);
  process.exitCode = 1;
}
