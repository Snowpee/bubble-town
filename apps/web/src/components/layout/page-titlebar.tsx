import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Menu, MessageSquarePlus, PanelLeftOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { cn } from '@/lib/utils';

interface PageTitlebarProps {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
}

export function PageTitlebar({ title, actions, className, titleClassName }: PageTitlebarProps) {
  const sidebarCollapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useWorkspaceStore((state) => state.setSidebarCollapsed);
  const mobileSidebarOpen = useWorkspaceStore((state) => state.mobileSidebarOpen);
  const setMobileSidebarOpen = useWorkspaceStore((state) => state.setMobileSidebarOpen);
  const isMacDesktop = window.bubbleTownDesktop?.platform === 'darwin';

  return (
    <div
      className={cn(
        'app-drag-region flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4 transition-[padding] duration-150 ease-out md:px-6',
        isMacDesktop && 'pl-[var(--macos-titlebar-control-reserve)] md:pl-6',
        isMacDesktop && sidebarCollapsed && 'pl-[var(--macos-titlebar-control-reserve)] md:pl-[var(--macos-titlebar-control-reserve)]',
        className,
      )}
    >
      <div className="relative flex min-w-0 flex-1 items-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="app-no-drag mr-2 h-9 w-9 shrink-0 rounded-lg p-0 md:hidden"
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          aria-label={mobileSidebarOpen ? '关闭侧边栏菜单' : '打开侧边栏菜单'}
        >
          {mobileSidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </Button>
        <div
          aria-hidden={!sidebarCollapsed}
          className={cn(
            'app-no-drag pointer-events-none absolute left-0 hidden items-center gap-1 opacity-0 transition-[opacity,transform] duration-200 ease-out md:flex',
            sidebarCollapsed && 'pointer-events-auto translate-x-0 opacity-100 delay-100',
            !sidebarCollapsed && '-translate-x-1',
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            tabIndex={sidebarCollapsed ? 0 : -1}
            className="h-9 w-9 shrink-0 rounded-lg p-0"
            onClick={() => setSidebarCollapsed(false)}
            aria-label="展开侧边栏"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-9 w-9 shrink-0 rounded-lg p-0"
            aria-label="新建会话"
          >
            <Link to="/chat" tabIndex={sidebarCollapsed ? 0 : -1}>
              <MessageSquarePlus className="h-4 w-4" />
              <span className="sr-only">新建会话</span>
            </Link>
          </Button>
        </div>
        <div
          className={cn(
            'min-w-0 text-sm font-semibold tracking-tight transition-[padding] duration-150 ease-out md:text-base',
            sidebarCollapsed && 'md:pl-20',
            titleClassName,
          )}
        >
          {title}
        </div>
      </div>
      {actions ? <div className="app-no-drag flex shrink-0 items-center justify-end gap-2">{actions}</div> : null}
    </div>
  );
}
