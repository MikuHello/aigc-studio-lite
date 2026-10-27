import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { PromptEditor, type PromptEditorHandle, type PromptEditorProps } from './PromptEditor';
import { Dialog } from './Dialog';
import { IconButton } from './ui/IconButton';
import { Button } from './ui/Button';
import { ReferencePreview } from './ReferenceTray';

export type { PromptEditorHandle } from './PromptEditor';

export const ExpandablePromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(
  function ExpandablePromptEditor(props, ref) {
    const inlineRef = useRef<PromptEditorHandle>(null);
    const expandedRef = useRef<PromptEditorHandle>(null);
    const [expanded, setExpanded] = useState(false);
    const [initialExpandedValue, setInitialExpandedValue] = useState('');
    const latest = useRef(props.initialValue);
    const update = (value: string) => {
      latest.current = value;
      props.onChange(value);
    };
    useImperativeHandle(
      ref,
      () => ({
        focus: () => (expanded ? expandedRef : inlineRef).current?.focus(),
        getMarkdown: () =>
          (expanded ? expandedRef : inlineRef).current?.getMarkdown() ?? latest.current,
        insertMarkdown: (value) =>
          (expanded ? expandedRef : inlineRef).current?.insertMarkdown(value),
        setMarkdown: (value) => {
          latest.current = value;
          inlineRef.current?.setMarkdown(value);
          expandedRef.current?.setMarkdown(value);
        },
      }),
      [expanded],
    );
    const close = () => {
      inlineRef.current?.setMarkdown(latest.current);
      setExpanded(false);
    };
    return (
      <div className="expandable-editor">
        <IconButton
          label="放大提示词编辑器"
          icon={<Maximize2 size={16} />}
          size="sm"
          className="editor-expand"
          disabled={props.disabled}
          onClick={() => {
            const value = inlineRef.current?.getMarkdown() ?? latest.current;
            latest.current = value;
            setInitialExpandedValue(value);
            setExpanded(true);
          }}
        />
        <PromptEditor {...props} ref={inlineRef} onChange={update} />
        <Dialog
          open={expanded}
          onClose={close}
          title="编辑提示词"
          size="wide"
          className="expanded-prompt-dialog"
          footer={
            <Button variant="primary" onClick={close}>
              完成
            </Button>
          }
        >
          {
            <>
              {props.attachments.length > 0 && (
                <div className="expanded-references">
                  {props.attachments.map((asset) => (
                    <ReferencePreview
                      key={asset.id}
                      source={asset.dataUrl}
                      kind={asset.kind ?? 'image'}
                      label={asset.label}
                    />
                  ))}
                </div>
              )}
              <PromptEditor
                {...props}
                ref={expandedRef}
                initialValue={initialExpandedValue}
                compact={false}
                onChange={update}
                onSubmit={
                  props.onSubmit
                    ? () => {
                        close();
                        props.onSubmit?.();
                      }
                    : undefined
                }
              />
            </>
          }
        </Dialog>
      </div>
    );
  },
);
