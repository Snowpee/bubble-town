import type { HTMLAttributes } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function LoadingLabel({
  className,
  label = '加载中',
  ...props
}: HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)} {...props}>
      <Skeleton className="h-2.5 w-2.5 rounded-full" />
      <span>{label}</span>
    </div>
  );
}

export function SessionListSkeleton({ className, count = 6 }: { className?: string; count?: number }) {
  return (
    <div className={cn('space-y-2 p-4', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-1 w-1 rounded-full" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatThreadSkeleton({ className, count = 4 }: { className?: string; count?: number }) {
  return (
    <div className={cn('mx-auto flex w-full max-w-3xl flex-col gap-4', className)}>
      {Array.from({ length: count }).map((_, index) => {
        const isAssistant = index % 2 === 1;

        return (
          <div key={index} className={cn('flex w-full', isAssistant ? 'justify-start' : 'justify-end')}>
            <div
              className={cn(
                'w-full max-w-[85%] space-y-3 rounded-3xl border border-border/60 p-4',
                isAssistant ? 'bg-card/70' : 'bg-secondary/30',
              )}
            >
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[90%]" />
                <Skeleton className="h-4 w-[70%]" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ChatComposerSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('mx-auto max-w-3xl', className)}>
      <div className="rounded-[28px] border border-border/70 bg-secondary/20 p-4 shadow-xs">
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-28 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function ProfileGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-3xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-36" />
            </div>
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-20 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatusCardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <div className="mt-4 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      ))}
    </>
  );
}

export function SettingsPanelSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-border bg-card/60 p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-10 w-full rounded-md" />
          <div className="mt-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      ))}
      <div className="rounded-2xl border border-border bg-card/60 p-4 lg:col-span-2">
        <Skeleton className="h-4 w-40" />
        <div className="mt-3 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}
