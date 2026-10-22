import { useMemo } from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const markdown = new Marked({
  gfm: true,
  breaks: true,
});

interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className = '' }: MarkdownProps) {
  const html = useMemo(() => {
    const raw = markdown.parse(content, { async: false });
    const source = typeof raw === 'string' ? raw : '';
    return DOMPurify.sanitize(source, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'textarea', 'object', 'embed'],
      FORBID_ATTR: ['style', 'onerror', 'onload'],
    });
  }, [content]);

  return (
    <div className={`md-body ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
