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
      <div className={cn(
        "relative flex min-w-0 flex-1 items-center",
        isMacDesktop && 'ml-20',
        )}>
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
