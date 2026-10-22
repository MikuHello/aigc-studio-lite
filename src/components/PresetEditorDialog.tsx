import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { PromptPreset } from '@/types';
import { useAppStore } from '@/store/appStore';
import { Dialog } from './Dialog';
import { PromptEditor } from './PromptEditor';
import { Button } from './ui/Button';
import { Field, TextInput } from './ui/Field';

interface PresetEditorDialogProps {
  open: boolean;
  preset: PromptPreset | null;
  onClose: () => void;
  onSaved?: (presetId: string) => void;
}

const FORM_ID = 'preset-editor-form';

export function PresetEditorDialog({ open, preset, onClose, onSaved }: PresetEditorDialogProps) {
  const addPreset = useAppStore((state) => state.addPreset);
  const updatePreset = useAppStore((state) => state.updatePreset);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(preset?.title ?? '');
    setContent(preset?.content ?? '');
    setTags(preset?.tags ?? []);
    setTagInput('');
  }, [open, preset]);

  const canSave = useMemo(() => title.trim().length > 0, [title]);

  const commitTag = () => {
    const values = tagInput
      .split(/[,，\s]+/)
      .map((value) => value.trim().replace(/^#/, ''))
      .filter(Boolean);
    if (values.length > 0) {
      setTags((current) => Array.from(new Set([...current, ...values])).slice(0, 8));
    }
    setTagInput('');
  };

  const save = () => {
    if (!canSave) return;
    const payload = {
      title: title.trim(),
      content,
      tags: [...tags, ...(tagInput.trim() ? [tagInput.trim().replace(/^#/, '')] : [])].slice(0, 8),
    };
    if (preset) {
      updatePreset(preset.id, payload);
      onSaved?.(preset.id);
    } else {
      const created = addPreset(payload);
      onSaved?.(created.id);
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={preset ? '编辑预设' : '新建预设'}
      size="large"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" disabled={!canSave}>
            保存
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        className="preset-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="preset-editor-top">
          <Field label="名称" htmlFor="preset-title">
            <TextInput
              id="preset-title"
              data-autofocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="名称"
              maxLength={60}
            />
          </Field>
          <div className="preset-tag-field">
            <Field label="标签" htmlFor="preset-tags">
              <TextInput
                id="preset-tags"
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
                    event.preventDefault();
                    commitTag();
                  }
                }}
                onBlur={commitTag}
                placeholder="输入后回车"
              />
            </Field>
            {tags.length > 0 && (
              <ul className="tag-editor-list" aria-label="已添加标签">
                {tags.map((tag) => (
                  <li key={tag}>
                    {tag}
                    <button
                      type="button"
                      aria-label={`移除标签 ${tag}`}
                      onClick={() => setTags((current) => current.filter((item) => item !== tag))}
                    >
                      <X size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="preset-editor-content">
          <span className="ui-field-label">内容</span>
          <div className="preset-editor-surface">
            <PromptEditor
              key={`${preset?.id ?? 'new'}:${open ? 'open' : 'closed'}`}
              initialValue={preset?.content ?? ''}
              placeholder="描述画面、风格与构图"
              attachments={[]}
              allowReferences={false}
              onChange={setContent}
            />
          </div>
        </div>
      </form>
    </Dialog>
  );
}
