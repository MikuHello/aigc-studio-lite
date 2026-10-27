import type { VideoStyle } from '@/types';

export const VIDEO_STYLES: Array<{ value: VideoStyle; label: string; prompt: string }> = [
  { value: 'none', label: '不指定', prompt: '' },
  {
    value: 'cinematic',
    label: '电影感',
    prompt: '电影质感，细腻的光影层次，克制的色彩，流畅且有叙事感的镜头运动。',
  },
  {
    value: 'documentary',
    label: '纪实',
    prompt: '纪实摄影风格，自然光线与真实材质，朴素的色彩，可信的动作和物理细节。',
  },
  {
    value: 'animation',
    label: '动画',
    prompt: '动画短片风格，清晰的造型与色彩，富有表现力的动作，连贯的镜头语言。',
  },
];

export function videoStylePrompt(prompt: string, style?: VideoStyle): string {
  const addition = VIDEO_STYLES.find((item) => item.value === style)?.prompt;
  return addition ? `${prompt.trim()}\n\n画面风格：${addition}`.trim() : prompt.trim();
}
