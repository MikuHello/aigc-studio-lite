import { adapters } from '@/providers';
import type { ProviderId } from '@/types';
import type { ProviderAdapter } from '@/providers/types';

export function getAdapter(provider: ProviderId): ProviderAdapter {
  return adapters[provider];
}
