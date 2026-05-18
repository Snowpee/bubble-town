import { forwardRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { History, MessageSquare, Moon, Settings2, Sun, UserRoundCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/chat', label: '聊天', icon: MessageSquare },
  { to: '/sessions', label: '会话', icon: History },
  { to: '/profiles', label: 'Profiles', icon: UserRoundCog },
  { to: '/settings', label: '设置', icon: Settings2 },
];

interface AppShellProps {
  children: ReactNode;
}

function AppNav({ compact = false, currentPath }: { compact?: boolean; currentPath: string }) {
  return (
    <nav className={cn('space-y-1.5', compact && 'flex flex-col items-center')}>
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = currentPath === item.to || currentPath.startsWith(`${item.to}/`);
        const link = (
          <Link
            key={item.to}
            to={item.to}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex items-center rounded-2xl text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground',
              compact ? 'h-11 w-11 justify-center px-0' : 'gap-3 px-3 py-2.5',
              isActive && 'bg-secondary text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {compact ? <span className="sr-only">{item.label}</span> : <span>{item.label}</span>}
          </Link>
        );

        if (!compact) {
          return link;
        }

        return (
          <Tooltip key={item.to}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

const ThemeToggleButton = forwardRef<
  HTMLButtonElement,
  {
    isDark: boolean;
    theme: 'light' | 'dark';
    toggleTheme: () => void;
    className?: string;
    compact?: boolean;
  }
>(({ isDark, theme, toggleTheme, className, compact = false }, ref) => {
  const label = theme === 'light' ? '亮色模式' : '暗色模式';

  return (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      size="sm"
      onClick={toggleTheme}
      aria-label={isDark ? '切换为亮色模式' : '切换为暗色模式'}
      title={isDark ? '切换为亮色模式' : '切换为暗色模式'}
      className={className}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {compact ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </Button>
  );
});
ThemeToggleButton.displayName = 'ThemeToggleButton';

export function AppShell({ children }: AppShellProps) {
  const { theme, toggleTheme, isDark } = useTheme();
  const location = useLocation();
  const isChatRoute = location.pathname === '/chat' || location.pathname.startsWith('/chat/');
  const desktopBridge = window.bubbleTownDesktop;
  const isMacDesktop = desktopBridge?.platform === 'darwin';
  const macOSTitlebarReserve = desktopBridge?.titlebarReserve ?? '4.75rem';

  return (
    <div
      className="flex h-dvh overflow-hidden bg-background text-foreground"
      style={{
        ['--sidebar-width' as string]: '4.5rem',
        ['--macos-titlebar-reserve' as string]: macOSTitlebarReserve,
      }}
    >
      <TooltipProvider delayDuration={100}>
        <aside
          className={cn(
            'app-drag-region sticky top-0 z-30 flex h-screen w-[var(--sidebar-width)] shrink-0 flex-col items-center overflow-y-auto border-r border-border/70 bg-card/70 px-3 pb-6 backdrop-blur',
            isMacDesktop ? 'pt-[var(--macos-titlebar-reserve)]' : 'pt-2',
          )}
        >
          <div className="app-no-drag mb-8 flex items-center justify-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/chat"
                  aria-label="Bubble Town"
                  className="flex h-12 w-12 items-center justify-center rounded-2xl text-primary transition hover:bg-secondary"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/20">H</div>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                <div className="font-medium">Bubble Town</div>
                <div className="text-muted-foreground">Hermes Workspace</div>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="w-full">
            <AppNav compact currentPath={location.pathname} />
          </div>
          <div className="app-no-drag mt-auto w-full border-t border-border/70 pt-6">
            <Tooltip>
              <TooltipTrigger asChild>
                <ThemeToggleButton
                  isDark={isDark}
                  theme={theme}
                  toggleTheme={toggleTheme}
                  compact
                  className="h-11 w-full justify-center rounded-2xl px-0"
                />
              </TooltipTrigger>
              <TooltipContent side="right">{theme === 'light' ? '亮色模式' : '暗色模式'}</TooltipContent>
            </Tooltip>
          </div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col',
              isChatRoute ? 'overflow-hidden' : 'overflow-y-auto px-6 py-8 lg:px-8',
            )}
          >
            {children}
          </div>
        </main>
      </TooltipProvider>
    </div>
  );
}
