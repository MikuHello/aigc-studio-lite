import { FloatingNotice } from '@/components/Toasts';
import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, LoaderCircle, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { ModelDescriptor, ModelKind, ProviderId } from '@/types';
import { customModel } from '@/lib/customModels';
import { normalizeBaseUrl } from '@/providers/shared';
import { adapters } from '@/providers';
import { resolveUseProxy, snapshotMeta, useAppStore } from '@/store/appStore';
import { saveMeta, writeSecrets } from '@/lib/storage';
import { getAdapter } from '@/agent/runtime';
import { PageOverlay } from '@/components/ui/PageOverlay';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

interface SettingsViewProps {
  onClose: () => void;
}

export function SettingsView({ onClose }: SettingsViewProps) {
  const providerConfigs = useAppStore((state) => state.providerConfigs);
  const models = useAppStore((state) => state.models);
  const preferences = useAppStore((state) => state.preferences);
  const proxyAvailable = useAppStore((state) => state.proxyAvailable);
  const setProviderConfig = useAppStore((state) => state.setProviderConfig);
  const beginProviderFetch = useAppStore((state) => state.beginProviderFetch);
  const setProviderModels = useAppStore((state) => state.setProviderModels);
  const setProviderError = useAppStore((state) => state.setProviderError);
  const setNetworkMode = useAppStore((state) => state.setNetworkMode);
  const [availableModels, setAvailableModels] = useState<ModelDescriptor[]>([]);
  const addToast = useAppStore((state) => state.addToast);

  const [provider, setProvider] = useState<ProviderId>('openai');
  const [baseUrl, setBaseUrl] = useState(
    providerConfigs.openai.apiKey ? providerConfigs.openai.baseUrl : '',
  );
  const [apiKey, setApiKey] = useState(providerConfigs.openai.apiKey);
  const selectProvider = (id: ProviderId) => {
    setAvailableModels([]);
    setProvider(id);
    setBaseUrl(providerConfigs[id].apiKey ? providerConfigs[id].baseUrl : '');
    setManualOpen(false);
    setModelQuery('');
    setApiKey(providerConfigs[id].apiKey);
    setError(null);
  };
  const [manualOpen, setManualOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [modelId, setModelId] = useState('');
  const [modelLabel, setModelLabel] = useState('');
  const [modelKind, setModelKind] = useState<ModelKind>('text');
  const [vision, setVision] = useState(false);
  const [tools, setTools] = useState(false);
  const [references, setReferences] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const providerModels = models.filter((model) => model.providerId === provider);
  const shownModels = providerModels.filter((model) =>
    `${model.label} ${model.modelId}`.toLowerCase().includes(modelQuery.toLowerCase()),
  );
  const candidates = availableModels.filter(
    (model) =>
      model.providerId === provider && !providerModels.some((added) => added.key === model.key),
  );
  const shownCandidates = candidates.filter((model) =>
    `${model.label} ${model.modelId}`.toLowerCase().includes(modelQuery.toLowerCase()),
  );
  const [showKey, setShowKey] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const useProxy = resolveUseProxy(preferences.networkMode, proxyAvailable);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const persistConnection = async () => {
    writeSecrets(useAppStore.getState().providerConfigs);
    await saveMeta(snapshotMeta(useAppStore.getState()));
  };

  const validatedEndpoint = () => {
    const endpoint = normalizeBaseUrl(baseUrl, provider);
    const url = new URL(endpoint);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    setBaseUrl(endpoint);
    return endpoint;
  };
  const openManual = (model?: ModelDescriptor) => {
    setEditingKey(model?.key ?? null);
    setModelId(model?.modelId ?? '');
    setModelLabel(model?.label ?? '');
    setModelKind(model?.kind ?? 'text');
    setVision(model?.capabilities.vision ?? false);
    setTools(model?.capabilities.tools ?? false);
    setReferences(model?.capabilities.imageEditing ?? false);
    setError(null);
    setManualOpen(true);
  };
  const saveManual = async () => {
    let endpoint: string;
    try {
      endpoint = validatedEndpoint();
    } catch {
      setError('请先填写有效的 API 地址。');
      return;
    }
    if (!apiKey.trim()) {
      setError('请先填写 API Key。');
      return;
    }
    try {
      const model = customModel({
        provider,
        id: modelId,
        label: modelLabel,
        kind: modelKind,
        vision,
        tools,
        references,
      });
      const existing = providerConfigs[provider].baseUrl === endpoint ? providerModels : [];
      if (existing.some((item) => item.key === model.key && item.key !== editingKey)) {
        setError('该模型已存在，请使用列表中的编辑按钮。');
        return;
      }
      setProviderConfig(provider, {
        apiKey: apiKey.trim(),
        baseUrl: endpoint,
        chatApi: provider === 'openai' ? 'auto' : undefined,
        rememberKey: true,
      });
      setProviderModels(provider, [...existing.filter((item) => item.key !== editingKey), model]);
      await persistConnection();
      setManualOpen(false);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模型保存失败');
    }
  };

  const connect = async () => {
    const key = apiKey.trim();
    if (!key || connecting) return;
    const target = provider;
    let endpoint: string;
    try {
      endpoint = validatedEndpoint();
    } catch {
      setError('请输入有效的 HTTP 或 HTTPS API 地址，不包含查询参数或账号密码。');
      return;
    }
    setError(null);
    setManualOpen(false);
    beginProviderFetch(target);
    setAvailableModels([]);
    setConnecting(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const adapter = getAdapter(target);
      const discovered = await adapter.listModels(
        { ...providerConfigs[target], apiKey: key, baseUrl: endpoint },
        { useProxy },
      );
      if (controller.signal.aborted) return;
      setProviderConfig(target, {
        apiKey: key,
        baseUrl: endpoint,
        chatApi: target === 'openai' ? 'auto' : undefined,
        rememberKey: true,
      });
      setAvailableModels(discovered);
      setProviderModels(target, providerConfigs[target].baseUrl === endpoint ? providerModels : []);
      await persistConnection();
      if (controller.signal.aborted) return;

      if (!discovered.length) addToast('未获取到模型，可手动添加模型 ID');
    } catch (reason) {
      if (controller.signal.aborted) return;
      const message = reason instanceof Error ? reason.message : '连接失败，请检查 API Key';
      setProviderError(target, message);
      setError(message);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setConnecting(false);
    }
  };

  return (
    <PageOverlay inline title="设置" onClose={onClose} className="settings-overlay">
      <div className="settings-content">
        <section className="settings-section" aria-labelledby="model-access-title">
          <div className="settings-section-head">
            <h2 id="model-access-title">模型接入</h2>
          </div>

          <form
            className="settings-connect-form"
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
          >
            <Field label="接口类型" htmlFor="settings-provider">
              <Select
                id="settings-provider"
                value={provider}
                disabled={connecting}
                onChange={selectProvider}
                options={[
                  { value: 'openai', label: 'OpenAI / 兼容服务（自动适配）' },
                  { value: 'google', label: 'Google Gemini API' },
                  { value: 'xai', label: 'xAI Grok API' },
                ]}
              />
            </Field>
            <Field
              label="API 地址"
              htmlFor="settings-base-url"
              hint="自动补全版本路径；已有 /v1、/v1beta 等路径会保留。"
            >
              <TextInput
                id="settings-base-url"
                value={baseUrl}
                disabled={connecting}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  setError(null);
                }}
                placeholder={adapters[provider].meta.defaultBaseUrl}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </Field>
            <Field label="API Key" htmlFor="settings-api-key">
              <div className="secret-field">
                <TextInput
                  id="settings-api-key"
                  disabled={connecting}
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setError(null);
                  }}
                  placeholder="粘贴 API Key"
                  autoComplete="off"
                  spellCheck={false}
                />
                <IconButton
                  label={showKey ? '隐藏 API Key' : '显示 API Key'}
                  icon={showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  onClick={() => setShowKey((value) => !value)}
                />
              </div>
            </Field>
            <div className="connection-actions">
              <Button
                type="submit"
                variant="primary"
                icon={connecting ? <LoaderCircle size={15} className="spin" /> : undefined}
                disabled={!apiKey.trim() || !baseUrl.trim() || connecting}
              >
                {connecting ? '获取中' : '获取模型'}
              </Button>
              <Button
                variant="ghost"
                icon={<Plus size={15} />}
                disabled={connecting}
                onClick={() => openManual()}
              >
                手动添加
              </Button>
            </div>
          </form>

          <p className="settings-detect">API Key 仅保存在浏览器，不写入服务端存储。</p>
          <FloatingNotice message={error} />

          {manualOpen && (
            <form
              className="manual-model-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveManual();
              }}
            >
              <div className="model-management-head">
                <strong>{editingKey ? '编辑模型' : '手动添加模型'}</strong>
                <IconButton
                  label="取消编辑模型"
                  icon={<X size={15} />}
                  size="sm"
                  onClick={() => setManualOpen(false)}
                />
              </div>
              <div className="manual-model-fields">
                <Field label="模型 ID" htmlFor="custom-model-id">
                  <TextInput
                    id="custom-model-id"
                    value={modelId}
                    required
                    placeholder="服务商提供的模型 ID"
                    onChange={(event) => setModelId(event.target.value)}
                  />
                </Field>
                <Field label="用途" htmlFor="custom-model-kind">
                  <Select
                    id="custom-model-kind"
                    value={modelKind}
                    onChange={setModelKind}
                    options={[
                      { value: 'text', label: '对话' },
                      { value: 'image', label: '生图', disabled: provider === 'anthropic' },
                    ]}
                  />
                </Field>
              </div>
              <Field label="显示名称（可选）" htmlFor="custom-model-label">
                <TextInput
                  id="custom-model-label"
                  value={modelLabel}
                  placeholder="默认使用模型 ID"
                  onChange={(event) => setModelLabel(event.target.value)}
                />
              </Field>
              <div className="model-capability-options">
                {modelKind === 'text' ? (
                  <>
                    <Checkbox checked={vision} onChange={setVision} label="支持识图" />
                    <Checkbox checked={tools} onChange={setTools} label="支持工具调用" />
                  </>
                ) : (
                  <Checkbox
                    checked={references}
                    disabled={provider === 'xai'}
                    onChange={setReferences}
                    label="支持参考图"
                  />
                )}
              </div>
              <Button type="submit" variant="primary" size="sm">
                保存模型
              </Button>
            </form>
          )}
          {providerModels.length > 0 && (
            <div className="settings-models">
              <div className="model-management-head">
                <strong>已添加模型</strong>
                <span>{providerModels.length}</span>
              </div>
              {providerModels.length > 6 && (
                <label className="ui-search-field">
                  <Search size={14} />
                  <input
                    aria-label="搜索已接入模型"
                    placeholder="搜索模型"
                    value={modelQuery}
                    onChange={(event) => setModelQuery(event.target.value)}
                  />
                </label>
              )}
              <ul className="settings-model-list">
                {shownModels.map((model) => (
                  <li key={model.key}>
                    <span className="settings-model-name">
                      <strong>{model.label}</strong>
                      {model.label !== model.modelId && <small>{model.modelId}</small>}
                    </span>
                    <span className="settings-model-kind">
                      {model.kind === 'image' ? '生图' : '对话'}
                      {model.manual ? ' · 手动' : ''}
                    </span>
                    <IconButton
                      label={`移除模型 ${model.label}`}
                      icon={<Trash2 size={14} />}
                      size="sm"
                      disabled={connecting}
                      onClick={() => {
                        setProviderModels(
                          provider,
                          providerModels.filter((item) => item.key !== model.key),
                        );
                        void persistConnection();
                      }}
                    />
                    <IconButton
                      label={`编辑模型 ${model.label}`}
                      icon={<Pencil size={14} />}
                      size="sm"
                      disabled={connecting}
                      onClick={() => openManual(model)}
                    />
                  </li>
                ))}
                {!shownModels.length && <li className="settings-note">没有匹配的模型</li>}
              </ul>
            </div>
          )}
          {candidates.length > 0 && (
            <div className="settings-models">
              <div className="model-management-head">
                <strong>可用模型</strong>
                <span>{candidates.length}</span>
              </div>
              <label className="ui-search-field">
                <Search size={14} />
                <input
                  aria-label="搜索可用模型"
                  placeholder="搜索可添加的模型"
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                />
              </label>
              <ul className="settings-model-list">
                {shownCandidates.map((model) => (
                  <li key={model.key}>
                    <span className="settings-model-name">
                      <strong>{model.label}</strong>
                    </span>
                    <span className="settings-model-kind">
                      {model.kind === 'image' ? '生图' : '对话'}
                    </span>
                    <IconButton
                      label={`添加模型 ${model.label}`}
                      icon={<Plus size={15} />}
                      size="sm"
                      disabled={connecting}
                      onClick={() => {
                        setProviderModels(provider, [...providerModels, model]);
                        void persistConnection();
                      }}
                    />
                  </li>
                ))}
                {!shownCandidates.length && <li className="settings-note">没有匹配的模型</li>}
              </ul>
            </div>
          )}
        </section>

        <section className="settings-section" aria-labelledby="network-title">
          <div className="settings-section-head">
            <h2 id="network-title">网络</h2>
          </div>
          <SegmentedControl
            value={preferences.networkMode}
            onChange={setNetworkMode}
            ariaLabel="网络方式"
            options={[
              { value: 'auto', label: '自动' },
              { value: 'direct', label: '直连' },
              { value: 'proxy', label: 'Worker 代理' },
            ]}
          />
          <p className="settings-note">
            当前：{useProxy ? 'Worker 代理' : '浏览器直连'}
            {proxyAvailable === false ? ' · 未检测到同源代理' : ''}
          </p>
        </section>

        <section className="settings-section" aria-labelledby="data-title">
          <div className="settings-section-head">
            <h2 id="data-title">数据</h2>
          </div>
          <p className="settings-note">作品、预设与对话保存在当前浏览器。</p>
        </section>
      </div>
    </PageOverlay>
  );
}
