import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from '@/hooks/usePresence';
import { popoverPosition } from '@/lib/popoverPosition';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import type { ModelDescriptor, ModelKind, ProviderId } from '@/types';

interface ModelPickerProps {
  models: ModelDescriptor[];
  value: string | null;
  onChange: (key: string) => void;
  onManage?: () => void;
  kind: ModelKind;
  label: string;
  disabled?: boolean;
  compact?: boolean;
}

const PROVIDER_ORDER: ProviderId[] = ['openai', 'anthropic', 'google', 'xai'];
const PROVIDER_NAMES: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  xai: 'xAI',
};

export function ModelPicker({
  models,
  value,
  onChange,
  onManage,
  kind,
  label,
  disabled = false,
  compact = false,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const present = usePresence(open, 120);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<ReturnType<typeof popoverPosition> | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const matching = useMemo(() => models.filter((model) => model.kind === kind), [models, kind]);
  const selected = matching.find((model) => model.key === value);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return matching;
    return matching.filter(
      (model) =>
        model.label.toLowerCase().includes(normalized) ||
        model.modelId.toLowerCase().includes(normalized) ||
        PROVIDER_NAMES[model.providerId].toLowerCase().includes(normalized),
    );
  }, [matching, query]);

  const grouped = useMemo(() => {
    return PROVIDER_ORDER.map((provider) => ({
      provider,
      items: filtered.filter((model) => model.providerId === provider),
    })).filter((group) => group.items.length > 0);
  }, [filtered]);

  const show = () => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition(popoverPosition(rect));
    setQuery('');
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    const handleScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointer);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', handleScroll, true);
    const timer = window.setTimeout(() => {
      if (searchRef.current) {
        searchRef.current.focus();
        return;
      }
      const option =
        popoverRef.current?.querySelector<HTMLButtonElement>('.model-option.is-selected') ??
        popoverRef.current?.querySelector<HTMLButtonElement>('.model-option');
      (
        option ??
        popoverRef.current?.querySelector<HTMLButtonElement>('button') ??
        popoverRef.current
      )?.focus();
    }, 40);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', handleScroll, true);
      window.clearTimeout(timer);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`model-trigger ${compact ? 'is-compact' : ''} ${open ? 'is-open' : ''}`}
        onClick={() => (open ? setOpen(false) : show())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
      >
        {selected ? (
          <span className="model-trigger-copy">
            <span className="model-trigger-label">{selected.label}</span>
            {!compact && (
              <span className="model-trigger-meta">{PROVIDER_NAMES[selected.providerId]}</span>
            )}
          </span>
        ) : (
          <span className="model-trigger-copy">
            <span className="model-trigger-label">选择模型</span>
          </span>
        )}
        <ChevronDown size={15} className="model-trigger-chevron" />
      </button>

      {present &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            className={`model-popover ${open ? '' : 'is-closing'}`}
            inert={!open}
            style={position}
            role="listbox"
            data-floating-control
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                triggerRef.current?.focus();
                return;
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              if (event.target instanceof HTMLInputElement && ['Home', 'End'].includes(event.key))
                return;
              const options = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('.model-option'),
              );
              if (!options.length) return;
              event.preventDefault();
              const index = options.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? options.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                      options.length;
              options[next]?.focus();
            }}
            onBlur={(event) => {
              if (
                event.relatedTarget &&
                !event.currentTarget.contains(event.relatedTarget) &&
                !triggerRef.current?.contains(event.relatedTarget)
              )
                setOpen(false);
            }}
            aria-label={label}
            tabIndex={-1}
          >
            <div className="model-popover-head">
              <div>
                <strong>{kind === 'image' ? '图像模型' : '文本模型'}</strong>
              </div>
              {onManage && (
                <button
                  type="button"
                  className="ui-text-button"
                  onClick={() => {
                    setOpen(false);
                    onManage();
                  }}
                >
                  设置
                </button>
              )}
            </div>
            {matching.length > 6 && (
              <label className="ui-search-field model-search">
                <Search size={14} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索模型名称"
                  aria-label="搜索模型名称"
                />
              </label>
            )}
            <div className="model-group-list">
              {grouped.length === 0 ? (
                <div className="model-empty">
                  <p>{matching.length === 0 ? '暂无模型' : '没有匹配结果'}</p>
                  {onManage && (
                    <button
                      type="button"
                      className="ui-text-button"
                      onClick={() => {
                        setOpen(false);
                        onManage();
                      }}
                    >
                      前往设置 <Plus size={12} />
                    </button>
                  )}
                </div>
              ) : (
                grouped.map((group) => (
                  <div className="model-group" key={group.provider}>
                    <div className="model-group-label">{PROVIDER_NAMES[group.provider]}</div>
                    {group.items.map((model) => (
                      <button
                        key={model.key}
                        type="button"
                        role="option"
                        aria-selected={model.key === value}
                        className={`model-option ${model.key === value ? 'is-selected' : ''}`}
                        onClick={() => {
                          onChange(model.key);
                          setOpen(false);
                          triggerRef.current?.focus();
                        }}
                      >
                        <span className="model-option-main">
                          <span className="model-option-title">{model.label}</span>
                          {model.modelId !== model.label && (
                            <span className="model-option-id">{model.modelId}</span>
                          )}
                          <span className="model-option-caps">
                            {kind === 'image'
                              ? model.capabilities.imageEditing
                                ? '参考图'
                                : null
                              : [
                                  model.capabilities.vision && '多模态',
                                  model.capabilities.tools && '工具',
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                          </span>
                        </span>
                        {model.key === value && (
                          <span className="model-selected-check">
                            <Check size={15} />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
