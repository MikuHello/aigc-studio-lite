import { failureNotice } from '@/lib/notices';
import { useAppStore } from '@/store/appStore';
import { useId, useState } from 'react';
import { Eye, EyeOff, Info } from 'lucide-react';
import type { ProviderConfig, ProviderId } from '@/types';
import { adapters } from '@/providers';
import { saveSupplier, supplierEndpoint } from '@/store/suppliers';
import { Dialog } from './Dialog';
import { Field, TextInput } from './ui/Field';
import { Select } from './ui/Select';
import { Switch } from './ui/Switch';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

export function SupplierEditor({
  id,
  config,
  onClose,
  onSaved,
  initialProvider = 'openai',
}: {
  id: string | null;
  config?: ProviderConfig;
  onClose: () => void;
  onSaved: (id: string) => void;
  initialProvider?: ProviderId;
}) {
  const [provider, setProvider] = useState<ProviderId>(config?.providerId ?? initialProvider);
  const [name, setName] = useState(config?.name ?? adapters[initialProvider].meta.name);
  const [baseUrl, setBaseUrl] = useState(
    config?.baseUrl ?? adapters[initialProvider].meta.defaultBaseUrl,
  );
  const [key, setKey] = useState(config?.apiKey ?? '');
  const [showKey, setShowKey] = useState(false);
  const [useWorkerProxy, setUseWorkerProxy] = useState(config?.useWorkerProxy === true);
  const proxyHelpId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const candidate: ProviderConfig = {
    ...config,
    name,
    providerId: provider,
    baseUrl,
    apiKey: key.trim(),
    useWorkerProxy,
    rememberKey: true,
    chatApi: config?.chatApi ?? 'auto',
  };
  let addressChanged = false;
  try {
    addressChanged = Boolean(id && config && supplierEndpoint(candidate) !== config.baseUrl);
  } catch {}
  const save = async () => {
    setError('');
    try {
      supplierEndpoint(candidate);
    } catch {
      setError('请输入有效的 API 地址，不包含查询参数或账号密码。');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveSupplier(id, candidate);
      onSaved(saved);
      useAppStore.getState().notify({ title: '已保存供应商', tone: 'success', context: name });
    } catch (error) {
      useAppStore.getState().notify(failureNotice('保存供应商失败', error, { context: name }));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      title={id ? '编辑供应商' : '添加供应商'}
      onClose={() => {
        if (!saving) onClose();
      }}
      size="medium"
      footer={
        <>
          <Button disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={saving || !name.trim() || !baseUrl.trim()}
            onClick={() => void save()}
          >
            {saving ? '保存中' : addressChanged ? '另存为新供应商' : '保存供应商'}
          </Button>
        </>
      }
    >
      <div className="supplier-form">
        <Field label="接入方式" htmlFor="supplier-protocol">
          <Select
            id="supplier-protocol"
            value={provider}
            disabled={Boolean(id) || saving}
            options={Object.values(adapters)
              .filter((adapter) => adapter.meta.id !== 'anthropic' || provider === 'anthropic')
              .map((adapter) => ({
                value: adapter.meta.id,
                label: adapter.meta.id === 'openai' ? 'OpenAI / 兼容接口' : adapter.meta.name,
              }))}
            onChange={(value) => {
              const next = value as ProviderId;
              setProvider(next);
              setBaseUrl(adapters[next].meta.defaultBaseUrl);
              setName(adapters[next].meta.name);
              setKey('');
              setError('');
            }}
          />
        </Field>
        <Field label="供应商名称" htmlFor="supplier-name">
          <TextInput
            id="supplier-name"
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：OpenAI 官方、我的中转服务"
          />
        </Field>
        <Field label="API 地址" htmlFor="supplier-url" error={error}>
          <TextInput
            id="supplier-url"
            value={baseUrl}
            disabled={saving}
            invalid={Boolean(error)}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setError('');
            }}
            placeholder={adapters[provider].meta.defaultBaseUrl}
          />
        </Field>
        <Field label="API Key" htmlFor="supplier-key">
          <div className="secret-field">
            <TextInput
              id="supplier-key"
              type={showKey ? 'text' : 'password'}
              value={key}
              disabled={saving}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
              placeholder="输入 API Key"
            />
            <IconButton
              label={showKey ? '隐藏 API Key' : '显示 API Key'}
              icon={showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              onClick={() => setShowKey(!showKey)}
            />
          </div>
        </Field>
        <div className="supplier-proxy-setting">
          <div className="supplier-proxy-label">
            <span>Worker 代理</span>
            <span className="supplier-proxy-help">
              <button
                type="button"
                className="supplier-proxy-help-trigger"
                aria-label="Worker 代理说明"
                aria-describedby={proxyHelpId}
              >
                <Info size={14} aria-hidden="true" />
              </button>
              <span id={proxyHelpId} className="supplier-proxy-tooltip" role="tooltip">
                默认直连，开启后请求和 API Key 经 Worker
                转发；平台默认请求事件对认证头脱敏，代理代码不存储或记录 Key。
              </span>
            </span>
          </div>
          <Switch
            label="Worker 代理"
            checked={useWorkerProxy}
            onChange={setUseWorkerProxy}
            disabled={saving}
          />
        </div>
        {addressChanged && (
          <p className="supplier-inline-note">地址变更将保存为新供应商，原配置与模型保留。</p>
        )}
      </div>
    </Dialog>
  );
}
