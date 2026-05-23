import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { getCompanionThemeStyle } from '@/lib/companion-theme';
import { useWorkspaceStore } from '@/lib/state/workspace-store';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const desktopBridge = window.bubbleTownDesktop;
  const isMacDesktop = desktopBridge?.platform === 'darwin';
  const companionTheme = useWorkspaceStore((state) => state.companionTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('macos-desktop-vibrancy', isMacDesktop);

    return () => {
      document.documentElement.classList.remove('macos-desktop-vibrancy');
    };
  }, [isMacDesktop]);

  useEffect(() => {
    const style = getCompanionThemeStyle(companionTheme);
    Object.entries(style).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, String(value));
    });
  }, [companionTheme]);

  return (
    <div className={cn('flex h-dvh overflow-hidden text-foreground', isMacDesktop ? 'macos-root-mask' : 'bg-background')}>
      <main
        style={getCompanionThemeStyle(companionTheme)}
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
