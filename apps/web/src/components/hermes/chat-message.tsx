import type { ChatMessage as ChatMessageType, ToolProgressEvent } from '@bubble-town/shared';
import { AlertCircle, CheckCircle2, ChevronDown, LoaderCircle, Wrench } from 'lucide-react';
import { MarkdownContent } from '@/components/hermes/markdown-content';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface ChatMessageProps {
  message: ChatMessageType;
  assistantMessageViewMode?: 'bubble' | 'document';
  showToolActivity?: boolean;
}

type JsonRecord = Record<string, unknown>;

const TOOL_SUMMARY_PRIORITY = ['title', 'url', 'message', 'status', 'scrolled', 'element_count'] as const;

function isMessageTool(toolName: string) {
  return toolName.trim().toLowerCase() === 'message';
}

function formatToolName(toolName: string) {
  if (isMessageTool(toolName)) {
    return '生成回复';
  }

  return toolName
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPhaseLabel(phase: ToolProgressEvent['phase']) {
  if (phase === 'start') return '已启动';
  if (phase === 'progress') return '进行中';
  if (phase === 'finish') return '已完成';
  return '失败';
}

function getPhaseTone(phase: ToolProgressEvent['phase']) {
  if (phase === 'finish') {
    return {
      badgeClassName: 'bg-emerald-500/10 text-emerald-600',
      icon: CheckCircle2,
      iconClassName: 'text-emerald-500',
    };
  }

  if (phase === 'error') {
    return {
      badgeClassName: 'bg-destructive/10 text-destructive',
      icon: AlertCircle,
      iconClassName: 'text-destructive',
    };
  }

  return {
    badgeClassName: 'bg-primary/10 text-primary',
    icon: LoaderCircle,
    iconClassName: 'text-primary',
  };
}

function tryParseJsonRecord(value: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return null;
    }
    return parsed as JsonRecord;
  } catch {
    return null;
  }
}

function toDisplayValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value == null) return '';
  return JSON.stringify(value, null, 2);
}

function isLongBlock(value: string) {
  return value.length > 120 || value.includes('\n');
}

function getToolSummaryEntries(payload: JsonRecord) {
  return TOOL_SUMMARY_PRIORITY.flatMap((key) => {
    const value = payload[key];
    if (value == null || (typeof value === 'string' && value.trim().length === 0)) {
      return [];
    }

    return [{ key, value: toDisplayValue(value) }];
  });
}

function getToolDetailEntries(payload: JsonRecord) {
  return Object.entries(payload).filter(
    ([key, value]) =>
      !TOOL_SUMMARY_PRIORITY.includes(key as (typeof TOOL_SUMMARY_PRIORITY)[number]) &&
      key !== 'snapshot' &&
      value != null &&
      (!(typeof value === 'string') || value.trim().length > 0),
  );
}

function truncateText(value: string, maxLength = 88) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function getToolPreviewText(value: string) {
  const payload = tryParseJsonRecord(value);

  if (!payload) {
    return truncateText(value.replace(/\s+/g, ' ').trim() || '查看详情');
  }

  const summaryEntries = getToolSummaryEntries(payload);
  const firstEntry = summaryEntries.find((entry) => entry.key !== 'url') ?? summaryEntries[0];
  if (firstEntry?.value) {
    return truncateText(firstEntry.value.replace(/\s+/g, ' ').trim());
  }

  const detailEntry = Object.entries(payload).find(([, rawValue]) => rawValue != null);
  if (!detailEntry) {
    return '查看详情';
  }

  return truncateText(toDisplayValue(detailEntry[1]).replace(/\s+/g, ' ').trim() || '查看详情');
}

function isActiveToolPhase(phase: ToolProgressEvent['phase']) {
  return phase === 'start' || phase === 'progress';
}

function getLatestActiveToolEvent(events: ToolProgressEvent[]) {
  return events
    .filter((event) => isActiveToolPhase(event.phase))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
}

function ToolPayload({ value, compact = false }: { value: string; compact?: boolean }) {
  const payload = tryParseJsonRecord(value);

  if (!payload) {
    if (!isLongBlock(value)) {
      return <div className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{value}</div>;
    }

    return (
      <ScrollArea className="max-h-56 rounded-xl border border-border/60 bg-background/70 p-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground">{value}</pre>
      </ScrollArea>
    );
  }

  const summaryEntries = getToolSummaryEntries(payload);
  const detailEntries = getToolDetailEntries(payload);
  const snapshot = typeof payload.snapshot === 'string' && payload.snapshot.trim().length > 0 ? payload.snapshot : undefined;

  return (
    <div className="space-y-3">
      {summaryEntries.length > 0 ? (
        <div className={cn('grid gap-2', compact ? 'grid-cols-1' : 'sm:grid-cols-2')}>
          {summaryEntries.map(({ key, value }) => (
            <div key={key} className="rounded-xl border border-border/60 bg-background/70 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">{key}</div>
              {key === 'url' ? (
                <a
                  href={value}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block truncate text-xs font-medium text-primary hover:underline"
                >
                  {value}
                </a>
              ) : (
                <div className="mt-1 whitespace-pre-wrap break-words text-xs font-medium leading-5 text-foreground/90">{value}</div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {detailEntries.length > 0 ? (
        <div className="space-y-2">
          {detailEntries.map(([key, rawValue]) => {
            const displayValue = toDisplayValue(rawValue);

            return (
              <div key={key} className="rounded-xl border border-dashed border-border/60 bg-background/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">{key}</div>
                {isLongBlock(displayValue) ? (
                  <ScrollArea className="mt-2 max-h-40 rounded-lg bg-background/70 p-3">
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground">
                      {displayValue}
                    </pre>
                  </ScrollArea>
                ) : (
                  <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{displayValue}</div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {snapshot ? (
        <details className="group rounded-xl border border-border/60 bg-background/40 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-foreground/90">
            页面快照
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <ScrollArea className="mt-3 max-h-64 rounded-lg bg-background/70 p-3">
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground">{snapshot}</pre>
          </ScrollArea>
        </details>
      ) : null}
    </div>
  );
}

function ToolEventCard({ event }: { event: ToolProgressEvent }) {
  const tone = getPhaseTone(event.phase);
  const Icon = tone.icon;
  const iconClassName = cn('mt-0.5 h-4 w-4 shrink-0', tone.iconClassName, event.phase !== 'finish' && event.phase !== 'error' && 'animate-spin');
  const previewText = event.message
    ? getToolPreviewText(event.message)
    : isMessageTool(event.toolName)
      ? '正在组织回复内容...'
      : '等待更多执行信息...';

  return (
    <div className="rounded-2xl border border-border/60 bg-background/70">
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className={iconClassName} />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground/90">{formatToolName(event.toolName)}</div>
            <div className="mt-1 truncate text-xs leading-5 text-muted-foreground">{previewText}</div>
          </div>
        </div>
        <div className={cn('shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em]', tone.badgeClassName)}>
          {formatPhaseLabel(event.phase)}
        </div>
      </div>
      <div className="border-t border-border/60 px-3 py-3">
        {event.message ? <ToolPayload value={event.message} compact /> : <div className="text-xs text-muted-foreground">等待更多执行信息...</div>}
      </div>
    </div>
  );
}

function MessageAttachments({ message }: { message: ChatMessageType }) {
  if (!message.attachments?.length) {
    return null;
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {message.attachments.map((attachment, index) => (
        <a
          key={`${attachment.url}-${index}`}
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-2xl border border-border/60 bg-background/60"
        >
          <img
            src={attachment.url}
            alt={attachment.name ?? `附件图片 ${index + 1}`}
            className="h-auto max-h-72 w-full object-cover"
          />
        </a>
      ))}
    </div>
  );
}

export function ChatMessage({ message, assistantMessageViewMode = 'bubble', showToolActivity = false }: ChatMessageProps) {
  const toolEvents = message.toolEvents ?? [];
  const latestActiveToolEvent = showToolActivity ? getLatestActiveToolEvent(toolEvents) : undefined;
  const hasAttachments = (message.attachments?.length ?? 0) > 0;
  const isStreamingPlaceholder = message.role === 'assistant' && message.content.length === 0 && !hasAttachments && !latestActiveToolEvent;
  const isToolMessage = message.role === 'tool';
  const shouldRenderMarkdown = message.role === 'assistant' && !isStreamingPlaceholder;
  const isAssistantDocumentMode = message.role === 'assistant' && assistantMessageViewMode === 'document';
  const isGeneratingReply = latestActiveToolEvent ? isMessageTool(latestActiveToolEvent.toolName) : false;

  if (isToolMessage) {
    return null;
  }

  return (
    <div
      className={cn(
        'text-sm',
        isAssistantDocumentMode
          ? 'w-full max-w-none px-0 py-0 text-foreground'
          : [
              'max-w-[80%] rounded-2xl px-4 py-3',
              message.role === 'user'
                ? 'ml-auto rounded-br-xs bg-primary text-primary-foreground'
                : 'rounded-bl-xs bg-muted text-card-foreground',
            ],
      )}
    >
      {isStreamingPlaceholder ? (
        <div className="flex items-center gap-2 whitespace-pre-wrap text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          <span>思考中...</span>
        </div>
      ) : (
        <div className="space-y-3">
          <MessageAttachments message={message} />
          {message.content ? (
            shouldRenderMarkdown ? (
              <MarkdownContent content={message.content} />
            ) : (
              <div className="whitespace-pre-wrap">{message.content}</div>
            )
          ) : null}
        </div>
      )}

      {latestActiveToolEvent ? (
        <div className={cn('mt-3', isAssistantDocumentMode ? 'w-full max-w-xl' : 'space-y-2')}>
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
            <Wrench className="h-3.5 w-3.5" />
            {isGeneratingReply ? '正在生成回复' : '工具执行中'}
          </div>
          <ToolEventCard event={latestActiveToolEvent} />
        </div>
      ) : null}
    </div>
  );
}
