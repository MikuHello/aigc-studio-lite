import rules from '@/templates/prompt-review-rules.txt?raw';
import type { ReviewSettings } from '@/types';

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  rules: rules.trim(),
  passTargetModel: true,
  passAspectRatio: true,
  useReferenceImages: false,
};
