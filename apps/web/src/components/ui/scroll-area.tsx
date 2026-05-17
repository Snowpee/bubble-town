import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  contentClassName?: string;
}

export function ScrollArea({ className, contentClassName, children, ...props }: ScrollAreaProps) {
  return (
    <div className={cn('overflow-y-auto', className)} {...props}>
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
