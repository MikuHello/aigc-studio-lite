import { failureNotice } from '@/lib/notices';
import { modelSupportReason, refreshModelCapabilities } from '@/providers/model-support';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { ModelDescriptor, ProviderId } from '@/types';
import { adapters } from '@/providers';
import { SEEDANCE_MODELS } from '@/providers/video-capabilities';
import {
  bindConnectionModel,
  connectionIdFor,
  connectionName,
  connectionProvider,
} from '@/lib/connections';
import { useAppStore } from '@/store/appStore';
import { removeSupplier, saveSupplier, saveSupplierModels } from '@/store/suppliers';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageOverlay } from '@/components/ui/PageOverlay';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { IconButton } from '@/components/ui/IconButton';
import { SupplierEditor } from '@/components/SupplierEditor';
import { SupplierModelEditor } from '@/components/SupplierModelEditor';
import { SupplierModelPicker, MODEL_KIND_LABELS } from '@/components/SupplierModelPicker';

export function SettingsView({
  onClose,
  initialProvider = 'openai',
}: {
  onClose: () => void;
  initialProvider?: ProviderId;
}) {
  const configs = useAppStore((state) => state.providerConfigs);
  const connectionToEdit = useAppStore((state) => state.connectionToEdit);
  const models = useAppStore((state) => state.models);
  const suppliers = Object.entries(configs).filter(
    ([id, config]) =>
      connectionProvider(id, config) &&
      (config.configured || config.apiKey || models.some((model) => connectionIdFor(model) === id)),
  );
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  useEffect(() => {
    if (!connectionToEdit) return;
    if (configs[connectionToEdit]) {
      setSelectedId(connectionToEdit);
      setEditing({ id: connectionToEdit });
    }
    useAppStore.setState({ connectionToEdit: null });
  }, [connectionToEdit, configs]);
  const [manual, setManual] = useState<{ model?: ModelDescriptor } | null>(null);
  const [picking, setPicking] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<Record<string, ModelDescriptor[]>>({});
  const runtime = useAppStore((state) => state.providerRuntime);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
      abort.current = null;
    },
    [],
  );
  const selected = selectedId ? configs[selectedId] : undefined;
  const provider = selectedId && selected ? connectionProvider(selectedId, selected) : undefined;
  const enabled = models
    .filter((model) => connectionIdFor(model) === selectedId)
    .map(refreshModelCapabilities);
  const candidates = [
    ...new Map(
      [
        ...(provider === 'volcengine' && discoveredModels[selectedId ?? ''] === undefined
          ? SEEDANCE_MODELS
          : []),
        ...(discoveredModels[selectedId ?? ''] ?? []),
        ...enabled,
      ].map((model) => [model.modelId, model]),
    ).values(),
  ];
  const goBack = () => {
    abort.current?.abort();
    abort.current = null;
    if (selectedId && busy)
      useAppStore.setState((state) => ({
        providerRuntime: { ...state.providerRuntime, [selectedId]: { status: 'idle' } },
      }));
    setSelectedId(null);
    setBusy(false);
    setPicking(false);
    setManual(null);
  };
  const fetchModels = async () => {
    if (!selectedId || !selected || !provider || busy) return;
    if (!selected.apiKey) {
      setEditing({ id: selectedId });
      return;
    }
    const id = selectedId;
    const config = { ...selected };
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    useAppStore.getState().beginProviderFetch(id);
    try {
      const timeout = setTimeout(() => controller.abort(), 45000);
      let found: ModelDescriptor[];
      try {
        found = await adapters[provider].listModels(config, {
          useProxy: config.useWorkerProxy === true,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (controller.signal.aborted || abort.current !== controller) return;
      setDiscoveredModels((previous) => ({
        ...previous,
        [id]: found.map((model) => bindConnectionModel(model, id, enabled)),
      }));
      useAppStore.setState((state) => ({
        providerRuntime: {
          ...state.providerRuntime,
          [id]: { status: 'connected', fetchedAt: Date.now() },
        },
      }));
      setPicking(true);
      if (!found.length)
        useAppStore.getState().notify({
          title: '未发现可用模型',
          detail: '可选择预设或手动添加模型。',
          context: connectionName(id, config),
        });
    } catch (reason) {
      if (abort.current !== controller) return;
      if (controller.signal.aborted) {
        if (abort.current === controller)
          useAppStore.getState().notify({
            title: '获取模型失败：请求超时',
            tone: 'error',
            context: connectionName(id, config),
            action: { kind: 'edit-connection', connectionId: id },
          });
      } else {
        const message =
          reason instanceof Error ? reason.message : '获取模型失败，请检查地址与 Key。';
        useAppStore.getState().notify(
          failureNotice('获取模型失败', reason, {
            context: connectionName(id, config),
            source: `connection:${id}`,
            action: { kind: 'edit-connection', connectionId: id },
          }),
        );
        useAppStore.getState().setProviderError(id, message);
      }
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setBusy(false);
        if (controller.signal.aborted)
          useAppStore.setState((state) => ({
            providerRuntime: { ...state.providerRuntime, [id]: { status: 'idle' } },
          }));
      }
    }
  };
  const [toggling, setToggling] = useState<string | null>(null);
  const toggleSupplier = async (id: string, checked: boolean) => {
    if (toggling) return;
    setToggling(id);
    try {
      const config = configs[id];
      await saveSupplier(id, {
        ...config,
        providerId: connectionProvider(id, config),
        disabled: !checked,
      });
    } catch (reason) {
      useAppStore.getState().notify(failureNotice('保存供应商失败', reason));
    } finally {
      setToggling(null);
    }
  };
  return (
    <PageOverlay inline title="设置" onClose={onClose} className="settings-overlay">
      <div className="supplier-settings">
        {!selected || !selectedId || !provider ? (
          <>
            <div className="supplier-heading">
              <div>
                <h2>供应商</h2>
              </div>
              <Button
                variant="primary"
                icon={<Plus size={16} />}
                onClick={() => setEditing({ id: null })}
              >
                添加供应商
              </Button>
            </div>
            {suppliers.length ? (
              <div className="supplier-list">
                {suppliers.map(([id, config]) => (
                  <div className={`supplier-card ${config.disabled ? 'is-disabled' : ''}`} key={id}>
                    <button
                      type="button"
                      className="supplier-card-link"
                      onClick={() => {
                        setSelectedId(id);
                      }}
                    >
                      <span className="supplier-card-main">
                        <strong>{connectionName(id, config)}</strong>
                        <span>{config.baseUrl}</span>
                      </span>
                      <span className="supplier-card-meta">
                        {config.useWorkerProxy && (
                          <span className="supplier-proxy-badge">Worker 代理</span>
                        )}
                        <small>
                          {models.filter((model) => connectionIdFor(model) === id).length} 个模型
                        </small>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                    <div className="supplier-toggle">
                      <IconButton
                        label={`删除供应商 ${connectionName(id, config)}`}
                        icon={<Trash2 size={15} />}
                        className="supplier-delete"
                        disabled={Boolean(toggling)}
                        onClick={() => setDeleting({ id, name: connectionName(id, config) })}
                      />
                      <Switch
                        checked={!config.disabled}
                        disabled={Boolean(toggling)}
                        label={`启用 ${connectionName(id, config)}`}
                        onChange={(checked) => void toggleSupplier(id, checked)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="supplier-empty">
                <h3>添加第一个供应商</h3>
                <p>连接官方服务或兼容接口，再选择要使用的模型。</p>
                <Button onClick={() => setEditing({ id: null })} icon={<Plus size={15} />}>
                  添加供应商
                </Button>
              </div>
            )}
            <p className="supplier-storage-note">配置、对话与作品记录保存在当前浏览器本地。</p>
          </>
        ) : (
          <>
            <button type="button" className="supplier-back" onClick={goBack}>
              <ArrowLeft size={16} />
              所有供应商
            </button>
            <div className="supplier-detail-heading">
              <div>
                <h2>{connectionName(selectedId, selected)}</h2>
              </div>
              <div className="supplier-detail-actions">
                <Button
                  icon={<Trash2 size={14} />}
                  className="supplier-delete"
                  disabled={busy}
                  onClick={() =>
                    setDeleting({ id: selectedId, name: connectionName(selectedId, selected) })
                  }
                >
                  删除供应商
                </Button>
                <Button
                  icon={<Pencil size={14} />}
                  disabled={busy}
                  onClick={() => setEditing({ id: selectedId })}
                >
                  编辑连接
                </Button>
              </div>
            </div>
            <div className="supplier-connection-summary">
              <span>API 地址</span>
              <code>{selected.baseUrl}</code>
              <span>请求方式</span>
              <span>{selected.useWorkerProxy ? 'Worker 代理' : '浏览器直连'}</span>
              <span>API Key</span>
              <span>
                {selected.apiKey ? '已配置' : '未配置'}
                {selected.apiKey && !selected.rememberKey && ' · 仅本次会话'}
              </span>
            </div>
            <div className="supplier-model-heading">
              <div>
                <h3>
                  启用模型 <span>{enabled.length}</span>
                  {runtime[selectedId]?.status === 'error' && (
                    <button
                      type="button"
                      className="supplier-fetch-error"
                      onClick={() =>
                        useAppStore.getState().showNoticeDetails({
                          title: '获取模型失败',
                          detail: runtime[selectedId].error,
                          tone: 'error',
                          context: connectionName(selectedId, selected),
                        })
                      }
                    >
                      获取失败
                    </button>
                  )}
                </h3>
              </div>
              <div>
                <Button
                  size="sm"
                  disabled={busy || selected.disabled}
                  icon={
                    busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />
                  }
                  onClick={() => void fetchModels()}
                >
                  {busy ? '获取中' : selected.apiKey ? '获取模型' : '配置 Key'}
                </Button>
                <Button size="sm" disabled={busy} onClick={() => setPicking(true)}>
                  选择模型
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  icon={<Plus size={14} />}
                  onClick={() => setManual({})}
                >
                  手动添加
                </Button>
              </div>
            </div>
            {enabled.length ? (
              <div className="supplier-enabled-list">
                {enabled.map((model) => (
                  <div className="supplier-enabled-row" key={model.key}>
                    <div className="supplier-model-identity">
                      <strong>{model.label}</strong>
                      <code hidden={model.label === model.modelId}>{model.modelId}</code>
                    </div>
                    <span className="supplier-model-kind">
                      {MODEL_KIND_LABELS[model.kind]}
                      {model.capabilities.video?.modes.includes('reference')
                        ? ' · 全能参考'
                        : model.capabilities.image?.supportsEdit
                          ? ' · 参考图'
                          : ''}
                    </span>
                    {modelSupportReason(model, selected) && (
                      <span className="supplier-model-unavailable">
                        {modelSupportReason(model, selected)}
                      </span>
                    )}
                    <div className="supplier-model-actions">
                      <IconButton
                        label={`编辑模型 ${model.label}`}
                        icon={<Pencil size={14} />}
                        size="sm"
                        disabled={busy}
                        onClick={() => setManual({ model })}
                      />
                      <IconButton
                        label={`移除模型 ${model.label}`}
                        icon={<Trash2 size={14} />}
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await saveSupplierModels(
                              selectedId,
                              enabled.filter((item) => item.key !== model.key),
                            );
                            setDiscoveredModels((previous) => ({
                              ...previous,
                              [selectedId]: candidates,
                            }));
                          } catch (reason) {
                            useAppStore.getState().notify(
                              failureNotice('移除模型失败', reason, {
                                context: connectionName(selectedId, selected),
                              }),
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="supplier-no-models">
                <p>还没有启用模型</p>
                <span>
                  {provider === 'volcengine'
                    ? '可直接选择 Seedance 预设，也可以填写自定义 Endpoint ID。'
                    : '获取模型后勾选启用；不支持获取列表的服务可手动添加。'}
                </span>
                {provider === 'volcengine' && (
                  <Button onClick={() => setPicking(true)} icon={<ArrowUpRight size={15} />}>
                    选择 Seedance 模型
                  </Button>
                )}
              </div>
            )}
          </>
        )}
        <ConfirmDialog
          open={Boolean(deleting)}
          title="删除供应商？"
          description={
            deleting
              ? `将删除「${deleting.name}」及其模型和 API Key，已有对话、作品和任务记录保留，不会取消远端任务。`
              : ''
          }
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            if (!deleting) return;
            await removeSupplier(deleting.id);
            if (selectedId === deleting.id) goBack();
            setDiscoveredModels((previous) => {
              const next = { ...previous };
              delete next[deleting.id];
              return next;
            });
            useAppStore
              .getState()
              .notify({ title: '已删除供应商', tone: 'success', context: deleting.name });
          }}
        />
        {editing && (
          <SupplierEditor
            key={editing.id ?? 'new'}
            id={editing.id}
            config={editing.id ? configs[editing.id] : undefined}
            initialProvider={initialProvider}
            onClose={() => setEditing(null)}
            onSaved={(id) => {
              setEditing(null);
              setSelectedId(id);
            }}
          />
        )}
        {picking && selectedId && (
          <SupplierModelPicker
            models={candidates}
            config={selected}
            enabled={enabled}
            onClose={() => setPicking(false)}
            onSave={(selection) => saveSupplierModels(selectedId, selection)}
            onConfigure={(model) => {
              setPicking(false);
              setManual({ model });
            }}
          />
        )}
        {manual && provider && selectedId && (
          <SupplierModelEditor
            provider={provider}
            model={manual.model}
            onClose={() => setManual(null)}
            onSave={async (model) => {
              if (
                enabled.some(
                  (item) => item.modelId === model.modelId && item.key !== manual.model?.key,
                )
              )
                throw new Error('此模型已启用，请编辑已有模型。');
              const reason = modelSupportReason(model, selected);
              if (reason) throw new Error(reason);
              await saveSupplierModels(selectedId, [
                ...enabled.filter((item) => item.key !== manual.model?.key),
                model,
              ]);
            }}
          />
        )}
      </div>
    </PageOverlay>
  );
}
