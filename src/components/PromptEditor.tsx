import { splitListItem, liftListItem } from '@tiptap/pm/schema-list';
import { useDragReset } from '@/hooks/useDragReset';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Extension, type Editor } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { isSupportedImageFile } from '@/lib/image';
import { SelectorCompatibility } from '@/lib/selectorCompatibility';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { Bold, Check, ChevronDown, Code, Italic, List, ListOrdered, Paperclip } from 'lucide-react';

export interface EditorAttachment {
  id: string;
  label: string;
  dataUrl: string;
}

export interface PromptEditorHandle {
  focus: () => void;
  insertMarkdown: (markdown: string) => void;
  setMarkdown: (markdown: string) => void;
  getMarkdown: () => string;
}

export interface PromptEditorProps {
  initialValue: string;
  placeholder: string;
  attachments: EditorAttachment[];
  onChange: (markdown: string) => void;
  onSubmit?: () => void;
  onAttachFiles?: (files: File[]) => void;
  onRequestUpload?: () => void;
  compact?: boolean;
  disabled?: boolean;
  allowReferences?: boolean;
}

interface MentionState {
  query: string;
  at: number;
  top: number;
  left: number;
}

interface SelectionBubbleState {
  top: number;
  left: number;
  bold: boolean;
  italic: boolean;
  code: boolean;
  block: string;
}

const MENTION_DECORATION_KEY = new PluginKey('mention-decoration');

function closeCodeAtCursor(
  view: EditorView,
  removeCount: number,
  includeNewline: boolean,
): boolean {
  const { state } = view;
  const { $from } = state.selection;
  if ($from.parent.type.name !== 'codeBlock') return false;
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return false;

  let from = $from.pos - removeCount;
  if (includeNewline && from > $from.start()) from -= 1;
  if (from < $from.start() - 1) return false;

  const blockEnd = $from.after();
  const tr = state.tr.delete(from, $from.pos);
  const insertAt = tr.mapping.map(blockEnd);
  tr.insert(insertAt, paragraph.create());
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

const ClosingCodeBlock = CodeBlock.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Backspace: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== this.name) return false;

        if ($from.parent.textContent.length === 0) {
          return this.editor.commands.clearNodes();
        }

        const isAtEnd = $from.parentOffset === $from.parent.content.size;
        if (!isAtEnd || !$from.parent.textContent.endsWith('\n')) return false;
        const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
        const currentLine = before.slice(before.lastIndexOf('\n') + 1);
        if (currentLine !== '') return false;
        return closeCodeAtCursor(this.editor.view, 1, false);
      },
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        if ($from.parent.type.name === 'paragraph') {
          const line = $from.parent.textContent.trim();
          if ($from.parentOffset === $from.parent.content.size && /^```[\w-]*$/.test(line)) {
            const language = line.slice(3) || null;
            return this.editor
              .chain()
              .deleteRange({ from: $from.start(), to: $from.start() + line.length })
              .setCodeBlock(language ? { language } : undefined)
              .run();
          }
          return false;
        }

        if ($from.parent.type.name !== this.name) return false;
        const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
        const currentLine = before.slice(before.lastIndexOf('\n') + 1);
        if (currentLine.trim() !== '```') return false;
        if (!$from.parent.textContent.endsWith(before.slice(before.lastIndexOf('\n') + 1))) {
          return false;
        }
        return closeCodeAtCursor(
          this.editor.view,
          currentLine.length,
          $from.parentOffset > currentLine.length,
        );
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey('close-code-fence'),
        props: {
          handleTextInput(view, _from, _to, text) {
            if (text !== '`') return false;
            const { $from } = view.state.selection;
            if ($from.parent.type.name !== 'codeBlock') return false;
            const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
            const currentLine = before.slice(before.lastIndexOf('\n') + 1);
            if (currentLine !== '``') return false;
            return closeCodeAtCursor(view, 2, $from.parentOffset > 2);
          },
          handlePaste(view, event) {
            if (!event.clipboardData) return false;
            const text = event.clipboardData.getData('text/plain').trim();
            const { $from } = view.state.selection;
            if ($from.parent.type.name !== 'codeBlock' || text !== '```') {
              return false;
            }
            const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
            const currentLine = before.slice(before.lastIndexOf('\n') + 1);
            if (currentLine !== '') return false;
            return closeCodeAtCursor(view, 0, $from.parentOffset > 0);
          },
        },
      }),
    ];
  },
});

const MentionDecorations = Extension.create({
  name: 'mentionDecorations',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: MENTION_DECORATION_KEY,
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, position) => {
              if (!node.isText || !node.text) return;
              const parent = state.doc.resolve(position).parent;
              if (parent.type.name === 'codeBlock') return;
              const regex = /@[^\s@，。；;]+/g;
              let match = regex.exec(node.text);
              while (match) {
                decorations.push(
                  Decoration.inline(
                    position + match.index,
                    position + match.index + match[0].length,
                    {
                      class: 'editor-at-ref',
                    },
                  ),
                );
                match = regex.exec(node.text);
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

function normalizeMarkdownOutput(markdown: string): string {
  // @compat TipTap adds trailing &nbsp; paragraphs when a fence closes; do not accumulate them in prompts.
  return markdown.replace(/\n*(?:&nbsp;\s*)+$/u, '').trimEnd();
}

function editorMarkdown(editor: Editor): string {
  return normalizeMarkdownOutput(editor.getMarkdown());
}

function currentMention(editor: Editor): { query: string; at: number } | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const { $from } = selection;
  const before = $from.parent.textBetween(
    Math.max(0, $from.parentOffset - 90),
    $from.parentOffset,
    '\n',
    '\n',
  );
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  return {
    query: match[2],
    at: selection.from - match[2].length - 1,
  };
}

function attachmentToken(label: string): string {
  return (
    label
      .replace(/\.[a-zA-Z0-9]+$/, '')
      .replace(/[\s@，。；;]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 42) || 'reference'
  );
}

function blockLabel(editor: Editor): string {
  if (editor.isActive('heading', { level: 1 })) return '标题 1';
  if (editor.isActive('heading', { level: 2 })) return '标题 2';
  if (editor.isActive('heading', { level: 3 })) return '标题 3';
  if (editor.isActive('orderedList')) return '有序列表';
  if (editor.isActive('bulletList')) return '无序列表';
  if (editor.isActive('codeBlock')) return '代码块';
  return '正文';
}

function hasFileDrag(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export const PromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(function PromptEditor(
  {
    initialValue,
    placeholder,
    attachments,
    onChange,
    onSubmit,
    onAttachFiles,
    onRequestUpload,
    compact = false,
    disabled = false,
    allowReferences = true,
  },
  ref,
) {
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const onAttachRef = useRef(onAttachFiles);
  const attachmentsRef = useRef(attachments);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [selectionBubble, setSelectionBubble] = useState<SelectionBubbleState | null>(null);
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const selectionFrame = useRef<number | null>(null);
  const dragDepthRef = useRef(0);
  useDragReset(() => {
    dragDepthRef.current = 0;
    setDragActive(false);
  });
  const mentionPopoverRef = useRef<HTMLDivElement>(null);
  const selectionBubbleRef = useRef<HTMLDivElement>(null);

  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;
  onAttachRef.current = onAttachFiles;
  attachmentsRef.current = attachments;

  const updateMention = useCallback(
    (editor: Editor) => {
      if (disabled || !allowReferences) {
        setMention(null);
        return;
      }
      const found = currentMention(editor);
      if (!found) {
        setMention(null);
        return;
      }
      try {
        const coords = editor.view.coordsAtPos(found.at);
        setMention({
          query: found.query,
          at: found.at,
          top: Math.min(coords.bottom + 8, window.innerHeight - 240),
          left: Math.min(Math.max(12, coords.left - 12), window.innerWidth - 280),
        });
      } catch {
        setMention(null);
      }
    },
    [allowReferences, disabled],
  );

  const updateSelectionBubble = useCallback(
    (current: Editor) => {
      if (disabled || !current.isEditable) {
        setSelectionBubble(null);
        setBlockMenuOpen(false);
        return;
      }
      const { from, to, empty } = current.state.selection;
      if (empty || !current.state.doc.textBetween(from, to, ' ').trim()) {
        setSelectionBubble(null);
        setBlockMenuOpen(false);
        return;
      }
      try {
        const width = selectionBubbleRef.current?.offsetWidth ?? 260;
        const bounds = current.view.dom.getBoundingClientRect();
        // @compat ProseMirror selection updates before the browser DOM range.
        let textFrom: number | null = null;
        let textTo = to;
        current.state.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isText) return;
          if (textFrom === null) textFrom = Math.max(from, pos);
          textTo = Math.min(to, pos + node.nodeSize);
        });
        const start = current.view.coordsAtPos(textFrom ?? from);
        const end = current.view.coordsAtPos(textFrom === null ? to : textTo);
        const visual = window.visualViewport;
        const viewportTop = visual?.offsetTop ?? 0;
        const viewportBottom = viewportTop + (visual?.height ?? window.innerHeight);
        const topEdge = Math.max(bounds.top, Math.min(start.top, end.top));
        const bottomEdge = Math.min(bounds.bottom, Math.max(start.bottom, end.bottom));
        if (bottomEdge < viewportTop || topEdge > viewportBottom) {
          setSelectionBubble(null);
          return;
        }
        const leftEdge = start.left;
        const rightEdge = Math.abs(start.top - end.top) < 4 ? end.right : start.left + width;
        const preferred = topEdge - 50;
        const top = Math.max(
          viewportTop + 8,
          Math.min(preferred >= viewportTop + 8 ? preferred : bottomEdge + 8, viewportBottom - 50),
        );
        setSelectionBubble({
          top,
          left: Math.max(
            Math.max(12, bounds.left),
            Math.min(
              (leftEdge + rightEdge) / 2 - width / 2,
              bounds.right - width,
              window.innerWidth - width - 12,
            ),
          ),
          bold: current.isActive('bold'),
          italic: current.isActive('italic'),
          code: current.isActive('code'),
          block: blockLabel(current),
        });
      } catch {
        setSelectionBubble(null);
      }
    },
    [disabled],
  );

  const editor = useEditor({
    extensions: [
      SelectorCompatibility,
      StarterKit.configure({
        codeBlock: false,
        dropcursor: false,
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
      ClosingCodeBlock.configure({
        exitOnTripleEnter: false,
        exitOnArrowDown: true,
        exitOnArrowUp: true,
        enableTabIndentation: false,
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
        showOnlyWhenEditable: false,
      }),
      Markdown.configure({
        markedOptions: { gfm: true, breaks: true },
      }),
      ...(allowReferences ? [MentionDecorations] : []),
    ],
    content: initialValue,
    contentType: 'markdown',
    editable: !disabled,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: compact ? 'prompt-prose is-compact' : 'prompt-prose',
        spellcheck: 'false',
        'aria-label': '提示词编辑器',
      },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files ?? []).filter(
          (file) => isSupportedImageFile(file) || file.type.startsWith('image/'),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        onAttachRef.current?.(files);
        return true;
      },
      handleDrop(_view, event) {
        const files = Array.from(event.dataTransfer?.files ?? []).filter(
          (file) => isSupportedImageFile(file) || file.type.startsWith('image/'),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        onAttachRef.current?.(files);
        return true;
      },
      handleKeyDown(view, event) {
        if (event.isComposing || event.keyCode === 229) return false;
        const { $from } = view.state.selection;
        const inList = Array.from(
          { length: $from.depth },
          (_, index) => $from.node(index + 1).type.name,
        ).includes('listItem');
        if (event.key === 'Enter' && event.shiftKey && inList) {
          event.preventDefault();
          const item = view.state.schema.nodes.listItem;
          return (
            splitListItem(item)(view.state, view.dispatch, view) ||
            liftListItem(item)(view.state, view.dispatch, view)
          );
        }
        if (event.key === 'Enter' && !event.shiftKey && onSubmitRef.current) {
          event.preventDefault();
          onSubmitRef.current?.();
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor: current }) {
      onChangeRef.current(editorMarkdown(current));
      updateMention(current);
      updateSelectionBubble(current);
    },
    onSelectionUpdate({ editor: current }) {
      updateMention(current);
      if (selectionFrame.current !== null) window.cancelAnimationFrame(selectionFrame.current);
      selectionFrame.current = window.requestAnimationFrame(() => {
        selectionFrame.current = null;
        if (!current.isDestroyed) updateSelectionBubble(current);
      });
    },
    onBlur({ event }) {
      if (!(event.relatedTarget as HTMLElement | null)?.closest('[data-floating-control]')) {
        setSelectionBubble(null);
        setBlockMenuOpen(false);
      }
    },
  });

  useEffect(
    () => () => {
      if (selectionFrame.current !== null) window.cancelAnimationFrame(selectionFrame.current);
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.commands.focus(),
      insertMarkdown: (markdown: string) => {
        if (!editor) return;
        editor
          .chain()
          .focus()
          .insertContent(markdown, { contentType: 'markdown', updateSelection: true })
          .run();
      },
      getMarkdown: () => (editor ? editorMarkdown(editor) : initialValue),
      setMarkdown: (markdown: string) => {
        if (!editor) return;
        editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: true });
        editor.commands.focus('end');
      },
    }),
    [editor, initialValue],
  );

  useEffect(() => {
    if (!mention) return;
    const close = () => setMention(null);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (mentionPopoverRef.current?.contains(target)) return;
      if (editor?.view.dom.contains(target)) return;
      setMention(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMention(null);
    };
    const handleScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && mentionPopoverRef.current?.contains(target)) return;
      if (target && editor?.view.dom.contains(target)) return;
      setMention(null);
    };
    window.addEventListener('resize', close);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mention, editor]);

  useEffect(() => {
    if (!selectionBubble) return;
    const close = () => {
      setSelectionBubble(null);
      setBlockMenuOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (selectionBubbleRef.current?.contains(target)) return;
      if (editor?.view.dom.contains(target)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const handleScroll = () => close();
    window.addEventListener('resize', close);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectionBubble, editor]);

  const selectAttachment = (attachment: EditorAttachment) => {
    if (!editor) return;
    const query = mention?.query ?? '';
    const to = editor.state.selection.from;
    const from = to - query.length - 1;
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContent(`@${attachmentToken(attachment.label)} `)
      .run();
    setMention(null);
  };

  const suggestions = attachments.filter((attachment) => {
    const query = mention?.query.trim().toLowerCase() ?? '';
    return !query || attachment.label.toLowerCase().includes(query);
  });

  useEffect(() => {
    setMentionIndex(0);
  }, [mention?.query, mention?.at]);

  useEffect(() => {
    if (!mention || suggestions.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setMentionIndex((index) => (index + 1) % suggestions.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setMentionIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const chosen = suggestions[Math.min(mentionIndex, suggestions.length - 1)];
        if (chosen) selectAttachment(chosen);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [mention, suggestions, mentionIndex, editor]);

  const refreshBubble = () => {
    if (!editor) return;
    window.requestAnimationFrame(() => {
      if (editor) updateSelectionBubble(editor);
    });
  };

  const toggleInline = (kind: 'bold' | 'italic' | 'code') => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (kind === 'bold') chain.toggleBold().run();
    else if (kind === 'italic') chain.toggleItalic().run();
    else chain.toggleCode().run();
    refreshBubble();
  };

  const setBlock = (kind: 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'code') => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (kind !== 'bullet' && kind !== 'ordered' && editor.isActive('listItem')) {
      chain.liftListItem('listItem');
    }
    if (kind === 'paragraph') chain.setParagraph().run();
    else if (kind === 'h1') chain.toggleHeading({ level: 1 }).run();
    else if (kind === 'h2') chain.toggleHeading({ level: 2 }).run();
    else if (kind === 'h3') chain.toggleHeading({ level: 3 }).run();
    else if (kind === 'bullet') chain.toggleBulletList().run();
    else if (kind === 'ordered') chain.toggleOrderedList().run();
    else chain.toggleCodeBlock().run();
    setBlockMenuOpen(false);
    setSelectionBubble(null);
  };

  const handleDragEnter = (event: React.DragEvent) => {
    if (disabled || !onAttachFiles || !hasFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (disabled || !onAttachFiles || !hasFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (!hasFileDrag(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!disabled && onAttachFiles && hasFileDrag(event)) {
      event.preventDefault();
      event.stopPropagation();
      onAttachFiles(Array.from(event.dataTransfer.files));
    }
    dragDepthRef.current = 0;
    setDragActive(false);
  };

  return (
    <div
      className={`markdown-editor ${compact ? 'is-compact' : ''} ${
        dragActive ? 'is-dragging' : ''
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDropCapture={handleDrop}
    >
      {dragActive && (
        <div className="editor-drop-hint" aria-hidden="true">
          <Paperclip size={20} />
          松开以添加参考图
        </div>
      )}

      <EditorContent editor={editor} />

      {selectionBubble &&
        createPortal(
          <div
            ref={selectionBubbleRef}
            className={`text-format-bubble ${selectionBubble.top > 236 ? 'menu-above' : ''}`}
            data-floating-control
            style={{ top: selectionBubble.top, left: selectionBubble.left }}
            role="toolbar"
            aria-label="文字格式"
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className={`text-format-button ${selectionBubble.bold ? 'is-active' : ''}`}
              aria-label="加粗"
              aria-pressed={selectionBubble.bold}
              onClick={() => toggleInline('bold')}
            >
              <Bold size={16} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              className={`text-format-button ${selectionBubble.italic ? 'is-active' : ''}`}
              aria-label="斜体"
              aria-pressed={selectionBubble.italic}
              onClick={() => toggleInline('italic')}
            >
              <Italic size={16} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              className={`text-format-button ${selectionBubble.code ? 'is-active' : ''}`}
              aria-label="行内代码"
              aria-pressed={selectionBubble.code}
              onClick={() => toggleInline('code')}
            >
              <Code size={16} />
            </button>
            <button
              type="button"
              className={`text-format-button ${selectionBubble.block === '无序列表' ? 'is-active' : ''}`}
              aria-label="无序列表"
              title="无序列表"
              aria-pressed={selectionBubble.block === '无序列表'}
              onClick={() => setBlock('bullet')}
            >
              <List size={16} />
            </button>
            <button
              type="button"
              className={`text-format-button ${selectionBubble.block === '有序列表' ? 'is-active' : ''}`}
              aria-label="有序列表"
              title="有序列表"
              aria-pressed={selectionBubble.block === '有序列表'}
              onClick={() => setBlock('ordered')}
            >
              <ListOrdered size={16} />
            </button>
            <span className="text-format-divider" aria-hidden="true" />
            <button
              type="button"
              className="text-format-block"
              aria-label="段落格式"
              aria-expanded={blockMenuOpen}
              onClick={() => setBlockMenuOpen((open) => !open)}
            >
              {selectionBubble.block}
              <ChevronDown size={14} />
            </button>
            {blockMenuOpen && (
              <div className="text-format-menu" role="menu">
                {[
                  ['paragraph', '正文'],
                  ['h1', '标题 1'],
                  ['h2', '标题 2'],
                  ['h3', '标题 3'],
                  ['bullet', '无序列表'],
                  ['ordered', '有序列表'],
                  ['code', '代码块'],
                ].map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitem"
                    className={selectionBubble.block === label ? 'is-current' : ''}
                    onClick={() =>
                      setBlock(
                        kind as 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'code',
                      )
                    }
                  >
                    <span>{label}</span>
                    {selectionBubble.block === label && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}

      {mention &&
        createPortal(
          <div
            ref={mentionPopoverRef}
            className="mention-popover"
            style={{ top: mention.top, left: mention.left }}
            role="listbox"
            data-floating-control
            aria-label="引用参考图"
          >
            <div className="mention-popover-head">
              <span>引用参考图</span>
            </div>
            {attachments.length === 0 ? (
              <button
                type="button"
                className="mention-empty"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setMention(null);
                  onRequestUpload?.();
                }}
              >
                <Paperclip size={16} />
                <span>先上传一张参考图</span>
              </button>
            ) : suggestions.length === 0 ? (
              <div className="mention-empty is-plain">没有匹配的参考图</div>
            ) : (
              <div className="mention-list">
                {suggestions.map((attachment, index) => (
                  <button
                    key={attachment.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className={`mention-option ${index === mentionIndex ? 'is-active' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setMentionIndex(index)}
                    onClick={() => selectAttachment(attachment)}
                  >
                    <img src={attachment.dataUrl} alt="" />
                    <span>{attachment.label}</span>
                    <span className="mention-enter">↵</span>
                  </button>
                ))}
              </div>
            )}
            {suggestions.length > 0 && <p className="mention-foot">↑↓ 选择 · Enter 引用</p>}
          </div>,
          document.body,
        )}
    </div>
  );
});
