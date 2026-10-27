import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { ProviderConfig, ProviderId } from '@/types';
import { adapters } from '@/providers';
import { saveSupplier, supplierEndpoint } from '@/store/suppliers';
import { Dialog } from './Dialog';
import { Field, TextInput } from './ui/Field';
import { Select } from './ui/Select';
import { Checkbox } from './ui/Checkbox';
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
  const [remember, setRemember] = useState(config?.rememberKey ?? true);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const candidate: ProviderConfig = {
    ...config,
    name,
    providerId: provider,
    baseUrl,
    apiKey: key.trim(),
    rememberKey: remember,
    chatApi: config?.chatApi ?? 'auto',
  };
  let addressChanged = false;
  try {
    addressChanged = Boolean(id && config && supplierEndpoint(candidate) !== config.baseUrl);
  } catch {}
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await saveSupplier(id, candidate);
      onSaved(saved);
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败，请重试。');
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
        <Field
          label="API 地址"
          htmlFor="supplier-url"
          hint="使用中转或兼容服务时，填写该服务提供的 API 基础地址。"
        >
          <TextInput
            id="supplier-url"
            value={baseUrl}
            disabled={saving}
            onChange={(event) => setBaseUrl(event.target.value)}
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
              placeholder="可稍后配置"
            />
            <IconButton
              label={showKey ? '隐藏 API Key' : '显示 API Key'}
              icon={showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              onClick={() => setShowKey(!showKey)}
            />
          </div>
        </Field>
        <Checkbox
          checked={remember}
          onChange={setRemember}
          disabled={saving}
          label="在此浏览器记住 Key"
        />
        {addressChanged && (
          <p className="supplier-inline-note">地址变更将保存为新供应商，原配置与模型保留。</p>
        )}
        {error && (
          <p className="ui-field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
