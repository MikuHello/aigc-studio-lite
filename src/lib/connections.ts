import { modelSupportReason, refreshModelCapabilities } from '@/providers/model-support';
import type {
  ConnectionMeta,
  ModelDescriptor,
  PersistedMeta,
  ProviderConfig,
  ProviderConfigs,
  ProviderId,
} from '@/types';
import { adapters, defaultProviderConfigs } from '@/providers';

export function connectionIdFor(
  model: Pick<ModelDescriptor, 'providerId' | 'connectionId'>,
): string {
  return model.connectionId ?? model.providerId;
}

export function connectionProvider(id: string, config: ConnectionMeta): ProviderId | undefined {
  const candidate = config.providerId ?? id;
  return Object.hasOwn(adapters, candidate) ? (candidate as ProviderId) : undefined;
}

export function connectionName(id: string, config?: ConnectionMeta): string {
  const provider = config && connectionProvider(id, config);
  return config?.name?.trim() || (provider ? adapters[provider].meta.name : '未配置供应商');
}

export function modelConnection(
  configs: ProviderConfigs,
  model: Pick<ModelDescriptor, 'providerId' | 'connectionId'>,
  allowDisabled = false,
): ProviderConfig {
  const id = connectionIdFor(model);
  const config = configs[id];
  if (!config) throw new Error('此模型关联的供应商不存在，请在设置中重新添加。');
  if (connectionProvider(id, config) !== model.providerId)
    throw new Error('模型与供应商接口类型不匹配，请重新选择模型。');
  if (config.disabled && !allowDisabled) throw new Error('此供应商已停用，请在设置中启用后重试。');
  return config;
}

export function availableModels(
  models: ModelDescriptor[],
  configs: ProviderConfigs,
): ModelDescriptor[] {
  return models.map(refreshModelCapabilities).filter((model) => {
    const config = configs[connectionIdFor(model)];
    return (
      config &&
      !config.disabled &&
      !modelSupportReason(model, config) &&
      connectionProvider(connectionIdFor(model), config) === model.providerId
    );
  });
}

export function bindConnectionModel(
  model: ModelDescriptor,
  connectionId: string,
  previous: ModelDescriptor[] = [],
): ModelDescriptor {
  const existing = previous.find(
    (item) => connectionIdFor(item) === connectionId && item.modelId === model.modelId,
  );
  return { ...model, connectionId, key: existing?.key ?? `${connectionId}::${model.modelId}` };
}

export function migrateConnections(meta: PersistedMeta): PersistedMeta {
  const defaults = defaultProviderConfigs();
  const connections: Record<string, ConnectionMeta> = {};
  for (const [id, raw] of Object.entries({ ...defaults, ...meta.connections })) {
    const providerId = connectionProvider(id, raw);
    if (!providerId) continue;
    connections[id] = {
      providerId,
      name: raw.name || adapters[providerId].meta.name,
      configured: raw.configured,
      disabled: raw.disabled,
      baseUrl: raw.baseUrl,
      rememberKey: raw.rememberKey,
      chatApi: raw.chatApi,
      useWorkerProxy: raw.useWorkerProxy === true,
    };
  }
  return {
    ...meta,
    version: 3,
    connections,
    models: meta.models.map((model) => ({ ...model, connectionId: connectionIdFor(model) })),
  };
}
