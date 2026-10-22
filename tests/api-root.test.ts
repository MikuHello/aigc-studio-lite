import { expect, it } from 'vitest';
import { normalizeBaseUrl } from '@/providers/shared';
it.each([
  ['https://gateway.example', 'https://gateway.example/v1'],
  ['https://gateway.example/', 'https://gateway.example/v1'],
  ['https://gateway.example/api', 'https://gateway.example/api/v1'],
  ['https://gateway.example/v1/', 'https://gateway.example/v1'],
  ['https://gateway.example/v1/v1/', 'https://gateway.example/v1'],
  ['https://gateway.example/v2', 'https://gateway.example/v2'],
  ['https://gateway.example/v1beta', 'https://gateway.example/v1beta'],
  ['https://gateway.example/v1/chat/completions', 'https://gateway.example/v1'],
  ['https://gateway.example/v1/images/generations', 'https://gateway.example/v1'],
])('normalizes %s without duplicate versions', (input, expected) => {
  expect(normalizeBaseUrl(input)).toBe(expected);
  expect(normalizeBaseUrl(normalizeBaseUrl(input))).toBe(expected);
});
it('uses the native Gemini version for an unversioned root', () => {
  expect(normalizeBaseUrl('https://generativelanguage.googleapis.com', 'google')).toBe(
    'https://generativelanguage.googleapis.com/v1beta',
  );
});
