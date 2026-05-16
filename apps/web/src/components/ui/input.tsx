import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn('flex h-10 w-full rounded-md border border-input bg-secondary px-3 py-2 text-sm outline-hidden ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring', className)}
      {...props}
    />
  );
});

Input.displayName = 'Input';
