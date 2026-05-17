import type { SessionSummary } from '@bubble-town/shared';
import type { ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface SessionListProps {
  sessions: SessionSummary[];
  activeSessionId?: string;
  onSelect?: (sessionId: string) => void;
  className?: string;
  contentClassName?: string;
  itemClassName?: string;
  showItemBorder?: boolean;
  showLastMessagePreview?: boolean;
  renderLeading?: (session: SessionSummary) => ReactNode;
  renderActions?: (session: SessionSummary) => ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
}

function formatSessionTime(value?: string) {
  if (!value) return '刚刚更新';

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  className,
  contentClassName,
  itemClassName: itemClassNameProp,
  showItemBorder = false,
  showLastMessagePreview = false,
  renderLeading,
  renderActions,
  emptyTitle = '还没有会话',
  emptyDescription = '发送第一条消息后，这里会自动显示最新会话记录。',
}: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-3xl border border-dashed border-border/70 bg-secondary/20 px-6 text-center">
        <div className="max-w-xs space-y-2">
          <div className="text-sm font-medium">{emptyTitle}</div>
          <p className="text-sm leading-6 text-muted-foreground">{emptyDescription}</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className={cn('min-h-0 flex-1 overflow-y-auto', className)} contentClassName={cn('space-y-2', contentClassName)}>
      {sessions.map((session) => {
        const leading = renderLeading?.(session);
        const actions = renderActions?.(session);
        const handleSelect = () => onSelect?.(session.sessionId);
        const handleInteractiveKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') {
            return;
          }

          event.preventDefault();
          handleSelect();
        };
        const itemClassName = cn(
          'flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left transition-colors',
          showItemBorder && 'border border-border/70',
          onSelect && 'cursor-pointer hover:bg-secondary/50',
          activeSessionId === session.sessionId ? 'bg-secondary text-foreground' : 'bg-transparent text-foreground',
          itemClassNameProp,
        );

        const content = (
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <span className="line-clamp-2 text-sm font-medium leading-6">{session.title}</span>
            </div>
            {showLastMessagePreview && session.lastMessagePreview ? (
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{session.lastMessagePreview}</p>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground/50">
              <span>{formatSessionTime(session.updatedAt)}</span>
              <span className="h-1 w-1 rounded-full bg-border" />
              <span className="truncate">{session.source}</span>
              <span className="h-1 w-1 rounded-full bg-border" />
              <span className="truncate">{session.messageCount} 条</span>
            </div>
          </div>
        );

        if (!onSelect || leading || actions) {
          return (
            <div
              key={session.sessionId}
              className={itemClassName}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onClick={onSelect ? handleSelect : undefined}
              onKeyDown={onSelect ? handleInteractiveKeyDown : undefined}
            >
              {leading ? (
                <div className="shrink-0 pt-1" onClick={(event) => event.stopPropagation()}>
                  {leading}
                </div>
              ) : null}
              {content}
              {actions ? (
                <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
                  {actions}
                </div>
              ) : null}
            </div>
          );
        }

        return (
          <button key={session.sessionId} type="button" onClick={handleSelect} className={itemClassName}>
            {content}
          </button>
        );
      })}
    </ScrollArea>
  );
}
