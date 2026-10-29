import type { ModelDescriptor, ProviderConfig } from '@/types';
import { bindConnectionModel, connectionIdFor, connectionProvider } from '@/lib/connections';
import { createId } from '@/lib/id';
import { normalizeBaseUrl } from '@/providers/shared';
import { saveMeta, writeSecrets } from '@/lib/storage';
import { snapshotMeta, useAppStore, withoutSupplier } from './appStore';

export function supplierEndpoint(config: ProviderConfig): string {
  if (!config.providerId) throw new Error('请选择接口类型。');
  const value = normalizeBaseUrl(config.baseUrl, config.providerId);
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('请输入有效的 API 地址，不包含查询参数或账号密码。');
  return value;
}

async function persistSuppliers(next: Parameters<typeof snapshotMeta>[0]) {
  const previous = useAppStore.getState();
  try {
    writeSecrets(next.providerConfigs, true);
    await saveMeta(snapshotMeta(next), true);
  } catch (error) {
    try {
      writeSecrets(previous.providerConfigs, true);
    } catch {
      throw new Error('配置未能完整保存，请检查浏览器存储权限后重新保存供应商。');
    }
    throw error;
  }
}

export async function saveSupplier(
  existingId: string | null,
  input: ProviderConfig,
): Promise<string> {
  const state = useAppStore.getState();
  const baseUrl = supplierEndpoint(input);
  const previous = existingId ? state.providerConfigs[existingId] : undefined;
  const sameEndpoint =
    previous &&
    connectionProvider(existingId!, previous) === input.providerId &&
    previous.baseUrl.replace(/\/+$/, '') === baseUrl.replace(/\/+$/, '');
  const id = existingId && sameEndpoint ? existingId : createId('supplier');
  const config = {
    ...input,
    rememberKey: true,
    useWorkerProxy: input.useWorkerProxy === true,
    baseUrl,
    name: input.name?.trim() || '自定义供应商',
    configured: true,
  };
  await persistSuppliers({ ...state, providerConfigs: { ...state.providerConfigs, [id]: config } });
  useAppStore.getState().setProviderConfig(id, config);
  if (
    !previous ||
    previous.apiKey !== config.apiKey ||
    previous.useWorkerProxy !== config.useWorkerProxy ||
    !sameEndpoint
  )
    useAppStore.setState((state) => ({
      providerRuntime: { ...state.providerRuntime, [id]: { status: 'idle' } },
    }));
  return id;
}

export async function saveSupplierModels(
  connectionId: string,
  selection: ModelDescriptor[],
): Promise<void> {
  const state = useAppStore.getState();
  const config = state.providerConfigs[connectionId];
  if (!config) throw new Error('供应商已不存在，请重新打开设置。');
  const provider = connectionProvider(connectionId, config);
  if (selection.some((model) => model.providerId !== provider))
    throw new Error('模型接口与供应商不匹配。');
  const bound = selection.map((model) => bindConnectionModel(model, connectionId, state.models));
  const models = [
    ...state.models.filter((model) => connectionIdFor(model) !== connectionId),
    ...bound,
  ];
  await persistSuppliers({ ...state, models });
  useAppStore.getState().setProviderModels(connectionId, bound);
}

export async function removeSupplier(connectionId: string): Promise<void> {
  const state = useAppStore.getState();
  if (!Object.hasOwn(state.providerConfigs, connectionId))
    throw new Error('供应商已不存在，请重新打开设置。');
  await persistSuppliers({ ...state, ...withoutSupplier(state, connectionId) });
  useAppStore.setState(withoutSupplier(useAppStore.getState(), connectionId));
}
