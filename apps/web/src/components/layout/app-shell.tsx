import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const desktopBridge = window.bubbleTownDesktop;
  const isMacDesktop = desktopBridge?.platform === 'darwin';

  useEffect(() => {
    document.documentElement.classList.toggle('macos-desktop-vibrancy', isMacDesktop);

    return () => {
      document.documentElement.classList.remove('macos-desktop-vibrancy');
    };
  }, [isMacDesktop]);

  return (
    <div className={cn('flex h-dvh overflow-hidden text-foreground', isMacDesktop ? 'macos-root-mask' : 'bg-background')}>
      <main
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background',
          isMacDesktop ? 'm-1 rounded-[14px] shadow-xs' : null,
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </main>
    </div>
  );
}
