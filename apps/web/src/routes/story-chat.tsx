import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage as ChatMessageType } from '@bubble-town/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUp, ChevronDown, ChevronUp, Square } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ChatMessage } from '@/components/hermes/chat-message';
import { ChatComposerSkeleton, ChatThreadSkeleton, LoadingLabel } from '@/components/loading/loading-state';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { fetchActiveStoryline, previewContextPack, streamStorylineChat } from '@/lib/api/story';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { cn } from '@/lib/utils';

interface StreamingState {
  status: 'streaming' | 'error';
  userMessage: ChatMessageType;
  assistantMessage: ChatMessageType;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'AbortError';
  }

  return error instanceof Error && error.name === 'AbortError';
}

function formatExchangeTime(value?: string): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const pad = (part: number) => String(part).padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ');
}

function stripMarkdownForPreview(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/```/g, ''))
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~#>]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLastOutputPreview(messages: ChatMessageType[]): string {
  const lastOutput = [...messages].reverse().find((message) => message.role === 'assistant' && message.content.trim());
  const source = stripMarkdownForPreview(lastOutput?.content ?? '');
  if (!source) {
    return '上次没有可预览的角色输出';
  }

  const maxLength = 100;
  const preview = source.length > maxLength ? `...${source.slice(-maxLength)}` : source;
  return `${preview}`;
}

function LastExchangeDivider({ time }: { time: string }) {
  if (!time) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 py-2 text-xs text-muted-foreground">
      <div className="h-px flex-1 bg-border/70" />
      <div className="shrink-0 rounded-full border border-border/70 bg-background px-3 py-1">
        上次交流･时间{time}
      </div>
      <div className="h-px flex-1 bg-border/70" />
    </div>
  );
}

export function StoryChatRoute() {
  const [draft, setDraft] = useState('');
  const [streamingState, setStreamingState] = useState<StreamingState | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [hasStartedChat, setHasStartedChat] = useState(false);
  const [conversationStartIndex, setConversationStartIndex] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingStateRef = useRef<StreamingState | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setActiveStorylineId = useWorkspaceStore((state) => state.setActiveStorylineId);
  const assistantMessageViewMode = useWorkspaceStore((state) => state.assistantMessageViewMode);
  const activeStorylineQuery = useQuery({ queryKey: ['active-storyline'], queryFn: fetchActiveStoryline });
  const activeStoryline = activeStorylineQuery.data?.activeStoryline;
  const contextPreviewQuery = useQuery({
    queryKey: ['context-preview', activeStoryline?.id],
    queryFn: () => previewContextPack(activeStoryline!.id),
    enabled: Boolean(activeStoryline?.id),
  });
  const isMacDesktop = window.bubbleTownDesktop?.platform === 'darwin';

  useEffect(() => {
    setActiveStorylineId(activeStoryline?.id);
  }, [activeStoryline?.id, setActiveStorylineId]);

  useEffect(() => {
    streamingStateRef.current = streamingState;
  }, [streamingState]);

  useEffect(() => {
    return () => abortControllerRef.current?.abort();
  }, []);

  const persistedMessages = useMemo(() => {
    return contextPreviewQuery.data?.contextPack.recentMessages.filter((message) => message.role !== 'tool') ?? [];
  }, [contextPreviewQuery.data?.contextPack.recentMessages]);

  const lastPersistedMessage = persistedMessages[persistedMessages.length - 1];
  const lastExchangeTime = formatExchangeTime(lastPersistedMessage?.createdAt ?? activeStoryline?.lastInteractionAt);
  const lastOutputPreview = getLastOutputPreview(persistedMessages);
  const isRegularChatState = hasStartedChat || Boolean(streamingState);
  const historicalMessageCount = conversationStartIndex ?? persistedMessages.length;
  const historicalMessages = isRegularChatState ? persistedMessages.slice(0, historicalMessageCount) : persistedMessages;
  const currentMessages = [
    ...(isRegularChatState ? persistedMessages.slice(historicalMessageCount) : []),
    ...(streamingState ? [streamingState.userMessage, streamingState.assistantMessage] : []),
  ];

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  async function refreshStorylineState() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['active-storyline'] }),
      queryClient.invalidateQueries({ queryKey: ['context-preview'] }),
    ]);
  }

  async function handleSend() {
    const input = draft.trim();
    if (!input || streamingState?.status === 'streaming' || !activeStoryline) {
      return;
    }

    const now = new Date().toISOString();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setHasStartedChat(true);
    setHistoryExpanded(true);
    setConversationStartIndex((current) => current ?? persistedMessages.length);
    setStreamingState({
      status: 'streaming',
      userMessage: {
        id: `pending-user-${Date.now()}`,
        role: 'user',
        content: input,
        createdAt: now,
      },
      assistantMessage: {
        id: `pending-assistant-${Date.now()}`,
        role: 'assistant',
        content: '',
        createdAt: now,
        toolEvents: [],
      },
    });

    try {
      setDraft('');
      await streamStorylineChat(
        { storylineId: activeStoryline.id, input },
        {
          onDelta: ({ delta }) => {
            setStreamingState((current) =>
              current
                ? {
                    ...current,
                    assistantMessage: {
                      ...current.assistantMessage,
                      content: `${current.assistantMessage.content}${delta}`,
                    },
                  }
                : current,
            );
          },
          onToolProgress: (event) => {
            setStreamingState((current) =>
              current
                ? {
                    ...current,
                    assistantMessage: {
                      ...current.assistantMessage,
                      toolEvents: [...(current.assistantMessage.toolEvents ?? []), event],
                    },
                  }
                : current,
            );
          },
        },
        { signal: abortController.signal },
      );
      setStreamingState(null);
      await refreshStorylineState();
    } catch (error) {
      if (isAbortError(error)) {
        setStreamingState(null);
        await refreshStorylineState();
        return;
      }

      setStreamingState((current) =>
        current
          ? {
              ...current,
              status: 'error',
              assistantMessage: {
                ...current.assistantMessage,
                content: error instanceof Error ? `流式请求失败：${error.message}` : '流式请求失败。',
              },
            }
          : current,
      );
    } finally {
      abortControllerRef.current = null;
    }
  }

  useEffect(() => {
    setHistoryExpanded(false);
    setHasStartedChat(false);
    setConversationStartIndex(null);
  }, [activeStoryline?.id]);

  function renderComposer(options: { centered?: boolean } = {}) {
    return (
      <div className={cn(options.centered && 'story-composer-glow')}>
        <div className="companion-glass relative z-10 rounded-[28px] ring-1 ring-ring/10 transition-colors focus-within:ring-ring/50">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.metaKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder="继续沟通"
            className="min-h-[2rem] rounded-[22px] border-0 bg-transparent p-4 shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-end gap-2 px-2 pb-2 pt-1">
            {streamingState?.status === 'streaming' ? (
              <Button variant="outline" onClick={handleStop} className="rounded-full">
                停止生成
                <Square className="ml-2 h-4 w-4 fill-current" />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="default"
              disabled={streamingState?.status === 'streaming' || !draft.trim()}
              onClick={() => void handleSend()}
              aria-label="发送消息"
              title="发送消息 (⌘ Enter)"
              className="h-10 w-10 rounded-full bg-primary p-0 text-primary-foreground hover:bg-primary/90"
            >
              <ArrowUp className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (activeStorylineQuery.isLoading) {
    return (
      <div className="companion-page companion-page--interior flex min-h-0 flex-1 flex-col px-6 py-5">
        <div className="companion-aura companion-aura--main" aria-hidden="true" />
        <div className="relative z-10">
          <LoadingLabel className="mx-auto w-full max-w-3xl" />
          <ChatThreadSkeleton />
        </div>
      </div>
    );
  }

  if (!activeStoryline) {
    return (
      <div className="companion-page companion-page--interior flex min-h-0 flex-1 items-center justify-center px-6 py-10">
        <div className="companion-aura companion-aura--main" aria-hidden="true" />
        <div className="companion-glass relative z-10 w-full max-w-md space-y-4 rounded-[28px] p-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">暂无可继续的剧情</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            当前还没有 active Storyline。返回首页后，可从右上角设置按钮初始化当前 Timeline。
          </p>
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => navigate('/')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="companion-page companion-page--interior flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="companion-aura companion-aura--main" aria-hidden="true" />
      <div className="companion-aura companion-aura--lower" aria-hidden="true" />
      <div className="companion-flow-grid" aria-hidden="true" />
      <div className="app-drag-region companion-chat-panel relative z-10 flex h-13 shrink-0 items-center px-4">
        <Button type="button" variant="ghost" size="sm" 
          className={cn(
            "rounded-xl text-foreground hover:bg-secondary/70",
            isMacDesktop && "ml-16",
          )} 
          onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1 text-left ml-2">
          <div className="truncate text-sm font-medium">{activeStoryline.title}</div>
        </div>
        <div className="w-16" />
      </div>

      <div className={cn('relative z-10 min-h-0 flex-1 px-6 py-5', isRegularChatState ? 'overflow-y-auto' : 'flex items-center justify-center overflow-hidden')}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {contextPreviewQuery.isLoading && !isRegularChatState ? (
            <div className="w-full">{renderComposer({ centered: true })}</div>
          ) : isRegularChatState ? (
            <>
              {historicalMessages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  assistantMessageViewMode={assistantMessageViewMode}
                  showToolActivity={message.id === streamingState?.assistantMessage.id}
                />
              ))}
              {historicalMessages.length > 0 ? <LastExchangeDivider time={lastExchangeTime} /> : null}
              {currentMessages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  assistantMessageViewMode={assistantMessageViewMode}
                  showToolActivity={message.id === streamingState?.assistantMessage.id}
                />
              ))}
              {historicalMessages.length === 0 && currentMessages.length === 0 ? (
                <div className="flex min-h-[360px] items-center justify-center text-center">
                  <div className="space-y-2">
                    <div className="text-2xl text-foreground">继续当前 Timeline</div>
                    <p className="text-sm leading-6 text-muted-foreground">输入一句话，回到这段对话。</p>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="w-full space-y-4">
              {persistedMessages.length > 0 ? (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setHistoryExpanded((current) => !current)}
                    className="companion-glass flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-card/70"
                  >
                    <div className="relative min-w-0 flex-1">
                      <div
                        className="overflow-hidden leading-6 opacity-70"
                        style={{
                          display: '-webkit-box',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 3,
                        }}
                      >
                        {lastOutputPreview}
                      </div>
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-[#fff4eb] to-transparent" />
                    </div>
                    {historyExpanded ? <ChevronUp className="mt-1 h-4 w-4 shrink-0" /> : <ChevronDown className="mt-1 h-4 w-4 shrink-0" />}
                  </button>
                  {historyExpanded ? (
                    <div className="max-h-[45vh] space-y-4 overflow-y-auto pr-1">
                      {persistedMessages.map((message) => (
                        <ChatMessage
                          key={message.id}
                          message={message}
                          assistantMessageViewMode={assistantMessageViewMode}
                          showToolActivity={false}
                        />
                      ))}
                      <LastExchangeDivider time={lastExchangeTime} />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-2xl text-foreground">继续当前 Timeline</div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">输入一句话，回到这段对话。</p>
                </div>
              )}
              <div className="mx-auto w-full max-w-3xl">
                {contextPreviewQuery.isLoading ? <ChatComposerSkeleton /> : renderComposer({ centered: true })}
              </div>
            </div>
          )}
        </div>
      </div>

      {isRegularChatState ? (
        <div className="relative z-10 shrink-0 bg-transparent pb-5 pt-2">
          <div className="mx-auto w-full max-w-3xl px-3 sm:px-0">
            {contextPreviewQuery.isLoading ? <ChatComposerSkeleton /> : renderComposer()}
          </div>
        </div>
      ) : null}
    </div>
  );
}
