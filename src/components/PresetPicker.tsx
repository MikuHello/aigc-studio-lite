import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from '@/hooks/usePresence';
import { popoverPosition } from '@/lib/popoverPosition';
import { BookOpen, Search, Settings2 } from 'lucide-react';
import type { PromptPreset } from '@/types';
import { markdownPreview } from '@/lib/text';
import { useAppStore } from '@/store/appStore';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

interface PresetPickerProps {
  onSelect: (preset: PromptPreset) => void;
  onManage: () => void;
  compact?: boolean;
}

export function PresetPicker({ onSelect, onManage, compact = false }: PresetPickerProps) {
  const presets = useAppStore((state) => state.presets);
  const [open, setOpen] = useState(false);
  const present = usePresence(open, 120);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof popoverPosition> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const tags = useMemo(
    () => Array.from(new Set(presets.flatMap((preset) => preset.tags))).sort(),
    [presets],
  );

  const effectiveTag = tag && tags.includes(tag) ? tag : null;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return presets.filter((preset) => {
      if (effectiveTag && !preset.tags.includes(effectiveTag)) return false;
      if (!normalized) return true;
      return (
        preset.title.toLowerCase().includes(normalized) ||
        preset.content.toLowerCase().includes(normalized)
      );
    });
  }, [presets, query, effectiveTag]);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const close = () => setOpen(false);
    const handleScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    window.addEventListener('resize', close);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('pointerdown', handlePointer);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('pointerdown', handlePointer);
      window.clearTimeout(timer);
    };
  }, [open]);

  return (
    <div className={`preset-picker ${compact ? 'is-compact' : ''}`} ref={rootRef}>
      <Button
        variant="ghost"
        size="sm"
        icon={<BookOpen size={14} />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          const rect = rootRef.current?.getBoundingClientRect();
          if (rect) setPosition(popoverPosition(rect, 340, 'start'));
          setOpen(true);
        }}
      >
        预设
      </Button>

      {present &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            className={`preset-menu ${open ? '' : 'is-closing'}`}
            inert={!open}
            style={position}
            role="dialog"
            aria-label="预设"
            data-floating-control
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              rootRef.current?.querySelector('button')?.focus();
            }}
            onBlur={(event) => {
              if (
                event.relatedTarget &&
                !event.currentTarget.contains(event.relatedTarget) &&
                !rootRef.current?.contains(event.relatedTarget)
              )
                setOpen(false);
            }}
          >
            <header className="preset-menu-header">
              <span>预设</span>
              <IconButton
                label="管理预设"
                icon={<Settings2 size={14} />}
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onManage();
                }}
              />
            </header>
            <label className="ui-search-field preset-menu-search">
              <Search size={13} aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索"
                aria-label="搜索预设"
              />
            </label>
            {tags.length > 0 && (
              <div className="preset-filter-bar is-inline" role="group" aria-label="预设标签">
                <button
                  type="button"
                  className={`preset-filter ${effectiveTag === null ? 'is-active' : ''}`}
                  aria-pressed={effectiveTag === null}
                  onClick={() => setTag(null)}
                >
                  全部
                </button>
                {tags.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`preset-filter ${effectiveTag === item ? 'is-active' : ''}`}
                    aria-pressed={effectiveTag === item}
                    onClick={() => setTag(effectiveTag === item ? null : item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
            <ul className="preset-menu-list">
              {filtered.length === 0 ? (
                <li className="preset-menu-empty">
                  {presets.length === 0 ? '还没有预设' : '没有匹配的预设'}
                </li>
              ) : (
                filtered.map((preset) => (
                  <li key={preset.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(preset);
                        setOpen(false);
                      }}
                    >
                      <span>{preset.title}</span>
                      <small>{markdownPreview(preset.content, 56)}</small>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
