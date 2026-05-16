import * as React from 'react';
import { cn } from '@/lib/utils';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn('flex min-h-[96px] w-full rounded-md border border-input bg-secondary px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring', className)}
      {...props}
    />
  );
});

Textarea.displayName = 'Textarea';
