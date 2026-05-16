import type { SessionSummary } from '@bubble-town/shared';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface SessionListProps {
  sessions: SessionSummary[];
  activeSessionId?: string;
  onSelect?: (sessionId: string) => void;
  className?: string;
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
    <ScrollArea className={cn('min-h-0 flex-1 overflow-y-auto p-4', className)}>
      <div className="space-y-2">
        {sessions.map((session) => {
          const itemClassName = cn(
            'flex w-full flex-col rounded-xl px-4 py-3 text-left transition-colors',
            onSelect && 'hover:bg-secondary/50',
            activeSessionId === session.sessionId ? 'bg-secondary text-foreground' : 'bg-transparent text-foreground',
          );

          const content = (
            <>
              <div className="flex items-start justify-between gap-3">
                <span className="line-clamp-2 text-sm font-medium leading-6">{session.title}</span>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{session.messageCount} 条</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatSessionTime(session.updatedAt)}</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span className="truncate">{session.source}</span>
              </div>
            </>
          );

          if (!onSelect) {
            return (
              <div key={session.sessionId} className={itemClassName}>
                {content}
              </div>
            );
          }

          return (
            <button key={session.sessionId} type="button" onClick={() => onSelect(session.sessionId)} className={itemClassName}>
              {content}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
