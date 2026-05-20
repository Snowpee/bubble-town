import { forwardRef, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  History,
  MessageSquarePlus,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  Settings2,
  Sun,
  UserRoundCog,
} from 'lucide-react';
import { DEFAULT_PROFILE_ID, type ProfilesResponse } from '@bubble-town/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { fetchSessions } from '@/lib/api/hermes';
import { markActiveProfileInResponse } from '@/lib/api/profile-cache';
import { fetchProfiles, switchProfile } from '@/lib/api/profiles';
import { logProfileDebug } from '@/lib/debug/profile-debug';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: ReactNode;
}

const mainActions = [
  { to: '/chat', label: '新聊天', icon: MessageSquarePlus },
  { to: '/sessions', label: 'History', icon: History },
  { to: '/settings', label: 'Diagnostics', icon: Settings2 },
  { to: '/profiles', label: 'Profiles', icon: UserRoundCog },
];

const DEFAULT_SIDEBAR_WIDTH = 304;
const MIN_SIDEBAR_WIDTH = 256;
const MAX_SIDEBAR_WIDTH = 384;
function clampSidebarWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function getActiveSessionId(pathname: string) {
  if (!pathname.startsWith('/chat/')) {
    return undefined;
  }

  const rawSessionId = pathname.slice('/chat/'.length);
  try {
    return decodeURIComponent(rawSessionId);
  } catch {
    return rawSessionId;
  }
}

function formatSessionTime(value?: string) {
  if (!value) return '';

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(value));
}

const ThemeToggleButton = forwardRef<
  HTMLButtonElement,
  {
    isDark: boolean;
    toggleTheme: () => void;
    className?: string;
  }
>(({ isDark, toggleTheme, className }, ref) => {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggleTheme}
      aria-label={isDark ? '切换为亮色模式' : '切换为暗色模式'}
      title={isDark ? '切换为亮色模式' : '切换为暗色模式'}
      className={className}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
});
ThemeToggleButton.displayName = 'ThemeToggleButton';

export function AppShell({ children }: AppShellProps) {
  const { toggleTheme, isDark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const setActiveProfileId = useWorkspaceStore((state) => state.setActiveProfileId);
  const sidebarCollapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useWorkspaceStore((state) => state.setSidebarCollapsed);
  const sidebarWidth = useWorkspaceStore((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkspaceStore((state) => state.setSidebarWidth);
  const mobileSidebarOpen = useWorkspaceStore((state) => state.mobileSidebarOpen);
  const setMobileSidebarOpen = useWorkspaceStore((state) => state.setMobileSidebarOpen);
  const sidebarResizeStartRef = useRef<{ pointerX: number; width: number } | null>(null);
  const activeSessionId = getActiveSessionId(location.pathname);
  const desktopBridge = window.bubbleTownDesktop;
  const isMacDesktop = desktopBridge?.platform === 'darwin';
  const macOSTitlebarReserve = desktopBridge?.titlebarReserve ?? '4.75rem';
  const macOSTitlebarControlReserve = desktopBridge?.titlebarControlReserve ?? '12rem';

  useEffect(() => {
    document.documentElement.classList.toggle('macos-desktop-vibrancy', isMacDesktop);

    return () => {
      document.documentElement.classList.remove('macos-desktop-vibrancy');
    };
  }, [isMacDesktop]);

  const sessionsQuery = useQuery({
    queryKey: ['sessions', activeProfileId],
    queryFn: () => fetchSessions(activeProfileId),
  });
  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: fetchProfiles });

  const switchProfileMutation = useMutation({
    mutationFn: (profileId: string) => {
      logProfileDebug('sidebar-switch-request', {
        currentActiveProfileId: activeProfileId,
        requestedProfileId: profileId,
      });
      return switchProfile(profileId);
    },
    onSuccess: async (result) => {
      const nextProfileId = result.activeProfile?.id ?? DEFAULT_PROFILE_ID;
      logProfileDebug('sidebar-switch-success', {
        previousActiveProfileId: activeProfileId,
        nextProfileId,
        returnedActiveProfileId: result.activeProfile?.id,
        returnedSessionProfiles: Array.from(new Set(result.sessions.map((session) => session.profileId))),
      });
      queryClient.setQueryData<ProfilesResponse>(['profiles'], (payload) => markActiveProfileInResponse(payload, nextProfileId, result.activeProfile));
      queryClient.setQueryData<ProfilesResponse>(['profiles-page'], (payload) => markActiveProfileInResponse(payload, nextProfileId, result.activeProfile));
      queryClient.setQueryData<ProfilesResponse>(['profiles-settings'], (payload) => markActiveProfileInResponse(payload, nextProfileId, result.activeProfile));
      setActiveProfileId(nextProfileId);
      if (location.pathname.startsWith('/chat/')) {
        navigate('/chat', { replace: true });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profiles'] }),
        queryClient.invalidateQueries({ queryKey: ['profiles-page'] }),
        queryClient.invalidateQueries({ queryKey: ['profiles-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions-index'] }),
      ]);
    },
    onError: (error, requestedProfileId) => {
      logProfileDebug('sidebar-switch-error', {
        requestedProfileId,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const sessions = sessionsQuery.data?.sessions ?? [];
  const profiles = profilesQuery.data?.profiles ?? [];
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId || profile.isActive);
  const collapsed = sidebarCollapsed;
  const visibleSidebarWidth = collapsed ? '0px' : `${clampSidebarWidth(sidebarWidth)}px`;

  function closeMobileSidebar() {
    setMobileSidebarOpen(false);
  }

  function handleSidebarResizePointerDown(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarResizeStartRef.current = {
      pointerX: event.clientX,
      width: clampSidebarWidth(sidebarWidth),
    };
    document.documentElement.style.cursor = 'col-resize';
    document.documentElement.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const start = sidebarResizeStartRef.current;
      if (!start) {
        return;
      }

      setSidebarWidth(clampSidebarWidth(start.width + moveEvent.clientX - start.pointerX));
    };

    const handlePointerUp = () => {
      sidebarResizeStartRef.current = null;
      document.documentElement.style.cursor = '';
      document.documentElement.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    window.addEventListener('pointercancel', handlePointerUp, { once: true });
  }

  function handleSessionClick(sessionId: string) {
    navigate(`/chat/${encodeURIComponent(sessionId)}`);
    closeMobileSidebar();
  }

  const sidebar = (
    <aside
      className={cn(
        'group/sidebar relative flex min-h-0 w-[19rem] shrink-0 flex-col text-sidebar-foreground transition-[left,width,opacity] duration-150 ease-out [bottom:0] [left:var(--mobile-sidebar-left)] [top:var(--mobile-sidebar-top)] md:bottom-auto md:left-auto md:top-auto md:h-full md:w-[var(--sidebar-width)]',
        isMacDesktop ? 'max-md:bg-sidebar/90 max-md:backdrop-blur-xl max-md:backdrop-saturate-150' : 'bg-sidebar',
        collapsed ? 'md:w-0 md:overflow-hidden md:border-r-0 md:opacity-0' : 'md:opacity-100',
        'fixed z-40 shadow-2xl md:static md:shadow-none',
      )}
      style={{
        ['--mobile-sidebar-left' as string]: mobileSidebarOpen ? '0px' : 'calc(-19rem - 1rem)',
        ['--mobile-sidebar-top' as string]: isMacDesktop ? '3.5rem' : '0px',
      }}
    >
      <div className={cn(
        'flex shrink-0 items-center gap-2 px-3 pb-3 h-14 pt-3 border-border/50',
        'app-drag-region',
        isMacDesktop && 'max-md:hidden md:border-none mt-1',
        !collapsed && 'md:border-r',
        )}>
        <Link
          to="/chat"
          onClick={closeMobileSidebar}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 transition', 
            isMacDesktop ? 'hidden' : null,
          )}
          aria-label="Bubble Town"
        >
          <div 
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">BT</div>
          <div className='flex flex-col'><span className="flex truncate text-base font-semibold h-5 items-center">Bubble Town</span><span className="flex text-xs text-muted-foreground/50 items-center">Hermes Desktop</span></div>
        </Link>
        {isMacDesktop ? <div className="hidden flex-1 md:block" /> : null}
        {!collapsed ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden h-9 w-9 shrink-0 rounded-lg p-0 md:inline-flex ml-auto"
            onClick={() => setSidebarCollapsed(true)}
            aria-label="收起侧边栏"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="app-no-drag ml-auto h-9 w-9 shrink-0 rounded-lg p-0 md:hidden"
          onClick={closeMobileSidebar}
          aria-label="关闭侧边栏"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
      <div className={cn(
        'flex min-h-0 flex-1 flex-col border-border/50', 
        isMacDesktop && 'md:border-none',
        !collapsed && 'md:border-r'
        )}
      >
        <nav className={cn(
          "app-no-drag shrink-0 space-y-0.5 px-2",
          isMacDesktop ? null : 'pt-3'
          )}>
          {mainActions.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.to || (item.to !== '/chat' && location.pathname.startsWith(`${item.to}/`));
            const link = (
              <Link
                key={item.to}
                to={item.to}
                onClick={closeMobileSidebar}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center rounded-lg text-sm text-sidebar-foreground/80 transition hover:bg-sidebar-accent-foreground/4 hover:text-sidebar-accent-foreground',
                  'gap-2 px-3',
                  isActive && 'bg-sidebar-accent-foreground/5 text-sidebar-accent-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );

            return link;
          })}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  'h-10 w-full rounded-lg text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent-foreground/4 hover:text-sidebar-accent-foreground',
                  'justify-start gap-2 px-3',
                )}
              >
                <MoreHorizontal className="h-4 w-4 shrink-0" />
                <span>更多</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="bottom" className="w-64 p-2 border-none ring-1 ring-foreground/5">
              <DropdownMenuItem asChild>
                <Link to="/sessions" onClick={closeMobileSidebar}>
                  <History className="mr-2 h-4 w-4" />
                  会话管理
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/profiles" onClick={closeMobileSidebar}>
                  <UserRoundCog className="mr-2 h-4 w-4" />
                  Profile 管理
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings" onClick={closeMobileSidebar}>
                  <Settings2 className="mr-2 h-4 w-4" />
                  设置
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        <div className="app-no-drag min-h-0 flex-1 overflow-hidden py-4">
          <div className="mb-2 px-5 text-xs font-medium text-sidebar-foreground/60">最近</div>
          <div className="h-full min-h-0 overflow-y-auto px-2">
            {sessionsQuery.isLoading ? (
              <div className="space-y-2 px-2">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className="h-9 animate-pulse rounded-lg bg-sidebar-accent/40" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-sidebar-border px-3 py-4 text-sm leading-6 text-sidebar-foreground/60">
                当前 profile 还没有会话。
              </div>
            ) : (
              <div className="space-y-0.5">
                {sessions.map((session) => {
                  const isActive = activeSessionId === session.sessionId;
                  return (
                    <button
                      key={session.sessionId}
                      type="button"
                      onClick={() => handleSessionClick(session.sessionId)}
                      className={cn(
                        'flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-sidebar-accent-foreground/5 hover:text-sidebar-accent-foreground',
                        isActive ? 'bg-sidebar-accent-foreground/5 text-sidebar-accent-foreground' : 'text-sidebar-foreground/80',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{session.title || '未命名会话'}</span>
                      <span className="shrink-0 text-xs text-sidebar-foreground/45">{formatSessionTime(session.updatedAt)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="app-no-drag mt-auto flex shrink-0 flex-row gap-2 p-2">
          <div className="order-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    'h-auto w-full rounded-lg text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    'justify-start gap-3 px-2 py-2',
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
                    {(activeProfile?.name ?? activeProfileId ?? 'P').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium">{activeProfile?.name ?? activeProfileId ?? 'Profile'}</span>
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-64 border-none ring-1 ring-foreground/5">
                <DropdownMenuLabel>切换 Profile</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {profiles.map((profile) => (
                  <DropdownMenuItem
                    key={profile.id}
                    disabled={switchProfileMutation.isPending || profile.id === activeProfileId}
                    onClick={() => {
                      switchProfileMutation.mutate(profile.id);
                      closeMobileSidebar();
                    }}
                  >
                    <span className="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                      {profile.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                    {profile.id === activeProfileId ? <span className="text-xs text-muted-foreground">当前</span> : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/profiles" onClick={closeMobileSidebar}>
                    <UserRoundCog className="mr-2 h-4 w-4" />
                    管理 Profile
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="order-2 ml-auto flex flex-col gap-2">
            <ThemeToggleButton
              isDark={isDark}
              toggleTheme={toggleTheme}
              className="h-10 flex-1 justify-start gap-3 rounded-lg px-3"
            />
          </div>
        </div>
      </div>
      {!collapsed ? (
        <div
          role="separator"
          tabIndex={0}
          aria-label="拖动调整侧边栏宽度"
          aria-orientation="vertical"
          className="app-no-drag absolute inset-y-0 right-0 z-20 hidden w-2 translate-x-1/2 cursor-col-resize touch-none md:block"
          onPointerDown={handleSidebarResizePointerDown}
          onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/sidebar:bg-border hover:bg-ring" />
        </div>
      ) : null}
    </aside>
  );

  return (
    <div
      className={cn('flex h-dvh overflow-hidden text-foreground', isMacDesktop ? 'macos-root-mask' : 'bg-background')}
      style={{
        ['--sidebar-width' as string]: visibleSidebarWidth,
        ['--macos-titlebar-reserve' as string]: macOSTitlebarReserve,
        ['--macos-titlebar-control-reserve' as string]: macOSTitlebarControlReserve,
      }}
    >
      <button
        type="button"
        aria-label="关闭侧边栏遮罩"
        className={cn(
          'fixed inset-0 z-30 bg-background/45 transition-opacity duration-150 ease-out md:hidden',
          mobileSidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={closeMobileSidebar}
      />
      {sidebar}
      <main className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
        isMacDesktop ? 'm-1 rounded-[14px] shadow-xs' : null,
        )}
        >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </main>
    </div>
  );
}
