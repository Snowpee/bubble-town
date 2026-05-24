import type { ChatMessage as ChatMessageType, ToolProgressEvent } from '@bubble-town/shared';
import { LoaderCircle, Sparkles, Wrench } from 'lucide-react';
import { MarkdownContent } from '@/components/hermes/markdown-content';
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

function getToolSummaryEntries(payload: JsonRecord) {
  return TOOL_SUMMARY_PRIORITY.flatMap((key) => {
    const value = payload[key];
    if (value == null || (typeof value === 'string' && value.trim().length === 0)) {
      return [];
    }

    return [{ key, value: toDisplayValue(value) }];
  });
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

function ActivityStatusLine({ event }: { event?: ToolProgressEvent }) {
  const isToolActivity = Boolean(event && !isMessageTool(event.toolName));
  const label = event
    ? isToolActivity
      ? `正在执行 ${formatToolName(event.toolName)}`
      : '正在生成回复'
    : '思考中';
  const detail = event?.message ? getToolPreviewText(event.message) : undefined;
  const Icon = isToolActivity ? Wrench : Sparkles;

  return (
    <div className="activity-status-line">
      <span className="activity-status-orbit" aria-hidden="true">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      </span>
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="shrink-0 font-medium text-foreground/85">{label}</span>
      {detail ? (
        <>
          <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden="true" />
          <span className="min-w-0 truncate text-muted-foreground">{detail}</span>
        </>
      ) : (
        <span className="activity-status-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      )}
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
  const hasMessageBody = hasAttachments || message.content.length > 0;
  const isStreamingPlaceholder = message.role === 'assistant' && message.content.length === 0 && !hasAttachments && !latestActiveToolEvent;
  const isToolMessage = message.role === 'tool';
  const shouldRenderMarkdown = message.role === 'assistant' && !isStreamingPlaceholder;
  const isAssistantDocumentMode = message.role === 'assistant' && assistantMessageViewMode === 'document';
  const isUserDocumentMode = message.role === 'user' && assistantMessageViewMode === 'document';

  if (isToolMessage) {
    return null;
  }

  return (
    <div
      className={cn(
        'text-base',
        isAssistantDocumentMode
          ? 'w-full max-w-none px-0 py-0 text-foreground'
          : [
              'max-w-[80%] rounded-2xl px-4 py-3',
              message.role === 'user'
                ? cn('ml-auto rounded-br-xs', isUserDocumentMode ? 'bg-muted text-card-foreground' : 'bg-primary text-primary-foreground')
                : 'rounded-bl-xs bg-muted text-card-foreground',
            ],
      )}
    >
      {isStreamingPlaceholder ? (
        <ActivityStatusLine />
      ) : hasMessageBody ? (
        <div className="space-y-3 message-attachments">
          <MessageAttachments message={message} />
          {message.content ? (
            shouldRenderMarkdown ? (
              <MarkdownContent content={message.content} />
            ) : (
              <div className="whitespace-pre-wrap">{message.content}</div>
            )
          ) : null}
        </div>
      ) : null}

      {latestActiveToolEvent ? (
        <div className={cn(hasMessageBody ? 'mt-3' : 'mt-0', isAssistantDocumentMode ? 'w-full max-w-xl' : '')}>
          <ActivityStatusLine event={latestActiveToolEvent} />
        </div>
      ) : null}
    </div>
  );
}
