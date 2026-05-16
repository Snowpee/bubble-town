import type { ComponentPropsWithoutRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

type CodeRendererProps = ComponentPropsWithoutRef<'code'> & {
  inline?: boolean;
};

const markdownComponents: Components = {
  a: ({ className, href, children, ...props }) => {
    const isExternal = typeof href === 'string' && /^https?:\/\//i.test(href);

    return (
      <a
        {...props}
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noreferrer' : undefined}
        className={cn('font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:text-primary/80', className)}
      >
        {children}
      </a>
    );
  },
  p: ({ className, ...props }) => <p {...props} className={cn('mb-3 leading-7 last:mb-0', className)} />,
  ul: ({ className, ...props }) => <ul {...props} className={cn('mb-3 list-disc space-y-2 pl-6 last:mb-0', className)} />,
  ol: ({ className, ...props }) => <ol {...props} className={cn('mb-3 list-decimal space-y-2 pl-6 last:mb-0', className)} />,
  li: ({ className, ...props }) => <li {...props} className={cn('leading-7', className)} />,
  blockquote: ({ className, ...props }) => (
    <blockquote
      {...props}
      className={cn('mb-3 border-l-2 border-border/80 pl-4 text-muted-foreground italic last:mb-0', className)}
    />
  ),
  h1: ({ className, ...props }) => <h1 {...props} className={cn('mb-3 text-lg font-semibold tracking-tight last:mb-0', className)} />,
  h2: ({ className, ...props }) => <h2 {...props} className={cn('mb-3 text-base font-semibold tracking-tight last:mb-0', className)} />,
  h3: ({ className, ...props }) => <h3 {...props} className={cn('mb-2 text-sm font-semibold tracking-tight last:mb-0', className)} />,
  hr: ({ className, ...props }) => <hr {...props} className={cn('my-4 border-border/70', className)} />,
  table: ({ className, ...props }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table {...props} className={cn('w-full border-collapse text-left text-sm', className)} />
    </div>
  ),
  thead: ({ className, ...props }) => <thead {...props} className={cn('border-b border-border/70', className)} />,
  tbody: ({ className, ...props }) => <tbody {...props} className={cn('[&_tr:last-child]:border-0', className)} />,
  tr: ({ className, ...props }) => <tr {...props} className={cn('border-b border-border/50', className)} />,
  th: ({ className, ...props }) => (
    <th {...props} className={cn('px-3 py-2 align-top text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground', className)} />
  ),
  td: ({ className, ...props }) => <td {...props} className={cn('px-3 py-2 align-top leading-6', className)} />,
  pre: ({ className, ...props }) => (
    <pre
      {...props}
      className={cn(
        'mb-3 overflow-x-auto rounded-xl border border-border/70 bg-background/70 p-4 text-[13px] leading-6 shadow-xs last:mb-0',
        className,
      )}
    />
  ),
  code: ({ inline, className, children, ...props }: CodeRendererProps) => (
    <code
      {...props}
      className={cn(
        inline
          ? 'rounded-md bg-background/80 px-1.5 py-0.5 font-mono text-[0.92em] text-foreground'
          : 'font-mono text-[13px] text-foreground',
        className,
      )}
    >
      {children}
    </code>
  ),
};

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn('min-w-0 break-words text-sm text-inherit', className)}>
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm, remarkBreaks]} skipHtml>
        {content}
      </ReactMarkdown>
    </div>
  );
}
