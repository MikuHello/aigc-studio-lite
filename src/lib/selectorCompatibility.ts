import { Extension } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import type { NodeViewConstructor } from '@tiptap/pm/view';

// @compat Ignore Selector metadata mutations to prevent an observer loop with ProseMirror node replacement.
export const SelectorCompatibility = Extension.create({
  name: 'selectorCompatibility',

  addProseMirrorPlugins() {
    const nodeViews: Record<string, NodeViewConstructor> = {};
    for (const name of [
      'paragraph',
      'heading',
      'blockquote',
      'bulletList',
      'orderedList',
      'listItem',
      'codeBlock',
      'horizontalRule',
      'hardBreak',
    ]) {
      const toDOM = this.editor.schema.nodes[name]?.spec.toDOM;
      if (!toDOM) continue;
      nodeViews[name] = (node, view) => {
        const { dom, contentDOM } = DOMSerializer.renderSpec(view.dom.ownerDocument, toDOM(node));
        return {
          dom,
          contentDOM,
          ignoreMutation: (mutation) =>
            (mutation.type === 'attributes' && mutation.attributeName === 'data-ai-id') ||
            (!contentDOM && mutation.type !== 'selection'),
        };
      };
    }
    return [new Plugin({ props: { nodeViews } })];
  },
});
