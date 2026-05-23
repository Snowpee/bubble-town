import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActiveStorylineResponse, ChatMessage as ChatMessageType, ContextPreviewResponse } from '@bubble-town/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUp, Maximize2, Square } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ChatMessage } from '@/components/hermes/chat-message';
import { ChatComposerSkeleton, ChatThreadSkeleton, LoadingLabel } from '@/components/loading/loading-state';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { fetchActiveStoryline, previewContextPack, streamStorylineChat } from '@/lib/api/story';
import { appendMessagesToContextPreview, mergeStoryChatCurrentMessages, updateActiveStorylineLastInteraction } from './story-chat-cache';
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
  const [hasStartedChat, setHasStartedChat] = useState(false);
  const [conversationStartIndex, setConversationStartIndex] = useState<number | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const programmaticScrollRef = useRef(false);
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
  const isRegularChatState = hasStartedChat || Boolean(streamingState);
  const historicalMessageCount = conversationStartIndex ?? persistedMessages.length;
  const historicalMessages = isRegularChatState ? persistedMessages.slice(0, historicalMessageCount) : persistedMessages;
  const currentMessages = mergeStoryChatCurrentMessages(
    isRegularChatState ? persistedMessages.slice(historicalMessageCount) : [],
    streamingState ? [streamingState.userMessage, streamingState.assistantMessage] : [],
  );
  const currentMessageFingerprint = currentMessages.map((message) => `${message.id}:${message.content.length}:${message.toolEvents?.length ?? 0}`).join('|');
  const historicalMessageFingerprint = historicalMessages.map((message) => message.id).join('|');

  function scrollChatToBottom(behavior: ScrollBehavior = 'smooth') {
    const scrollContainer = chatScrollRef.current;
    if (!scrollContainer) {
      return;
    }

    programmaticScrollRef.current = true;
    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior });
    window.setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 120);
  }

  function handleChatScroll() {
    const scrollContainer = chatScrollRef.current;
    if (!scrollContainer || programmaticScrollRef.current) {
      return;
    }

    const distanceToBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
    autoScrollRef.current = distanceToBottom < 80;
  }

  useEffect(() => {
    if (isRegularChatState || contextPreviewQuery.isLoading) {
      return;
    }

    const scrollContainer = previewScrollRef.current;
    if (!scrollContainer) {
      return;
    }

    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [contextPreviewQuery.isLoading, isRegularChatState, persistedMessages.length]);

  function expandToRegularChat() {
    autoScrollRef.current = true;
    setHasStartedChat(true);
    setConversationStartIndex((current) => current ?? persistedMessages.length);
  }

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  async function refreshStorylineState() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['active-storyline'] }),
      queryClient.invalidateQueries({ queryKey: ['context-preview'] }),
    ]);
  }

  function seedCompletedStreamingPreview() {
    const completedState = streamingStateRef.current;
    if (!completedState || !activeStoryline?.id) {
      return;
    }

    const completedMessages = [completedState.userMessage, completedState.assistantMessage];
    const latestTimestamp = completedMessages[completedMessages.length - 1]?.createdAt ?? completedState.userMessage.createdAt;

    queryClient.setQueryData(['context-preview', activeStoryline.id], (current: ContextPreviewResponse | undefined) =>
      appendMessagesToContextPreview(current, completedMessages),
    );
    queryClient.setQueryData(['active-storyline'], (current: ActiveStorylineResponse | undefined) =>
      updateActiveStorylineLastInteraction(current, latestTimestamp),
    );
  }

  async function handleSend() {
    const input = draft.trim();
    if (!input || streamingState?.status === 'streaming' || !activeStoryline) {
      return;
    }

    const now = new Date().toISOString();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    autoScrollRef.current = true;
    setHasStartedChat(true);
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
      seedCompletedStreamingPreview();
      setStreamingState(null);
      await refreshStorylineState();
    } catch (error) {
      if (isAbortError(error)) {
        seedCompletedStreamingPreview();
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
    setHasStartedChat(false);
    setConversationStartIndex(null);
    autoScrollRef.current = true;
  }, [activeStoryline?.id]);

  useEffect(() => {
    if (!isRegularChatState) {
      return;
    }

    window.requestAnimationFrame(() => scrollChatToBottom('auto'));
  }, [activeStoryline?.id, isRegularChatState]);

  useEffect(() => {
    if (!isRegularChatState || !autoScrollRef.current) {
      return;
    }

    window.requestAnimationFrame(() => scrollChatToBottom('smooth'));
  }, [isRegularChatState, currentMessageFingerprint, historicalMessageFingerprint]);

  function renderComposer(options: { centered?: boolean } = {}) {
    return (
      <div className={cn('story-composer', options.centered && 'story-composer-glow')}>
        <div className="relative bg-background z-10 overflow-hidden rounded-[28px] ring-1 ring-ring/10 focus-within:ring-ring/50">
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
            className="block min-h-[2rem] resize-none appearance-none rounded-[22px] border-0 !bg-transparent bg-none p-4 shadow-none focus-visible:ring-0"
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

      <div
        ref={chatScrollRef}
        onScroll={handleChatScroll}
        className={cn('relative z-10 min-h-0 flex-1 px-6 py-5', isRegularChatState ? 'overflow-y-auto' : 'flex items-center justify-center overflow-hidden')}
      >
        <div className={cn('mx-auto flex w-full max-w-3xl flex-col gap-4', isRegularChatState && 'story-chat-expanded')}>
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
            <div className="story-continue-stage w-full">
              {persistedMessages.length > 0 ? (
                <div className="story-history-fade relative min-h-[clamp(15rem,38vh,24rem)]">
                  <div
                    ref={previewScrollRef}
                    className="story-history-preview relative max-h-[clamp(15rem,38vh,24rem)] overflow-y-auto overscroll-contain px-3 pb-4 pt-2"
                    aria-label="上次聊天预览"
                  >
                    <div className="space-y-4 pb-2 pt-10">
                      {persistedMessages.map((message) => (
                        <div key={message.id}>
                          <ChatMessage
                            message={message}
                            assistantMessageViewMode={assistantMessageViewMode}
                            showToolActivity={false}
                          />
                        </div>
                      ))}
                      <LastExchangeDivider time={lastExchangeTime} />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={expandToRegularChat}
                    className="absolute bottom-1 left-1 z-20 isolate h-10 overflow-hidden rounded-full border-border/70 bg-transparent px-4 text-foreground shadow-[0_16px_44px_color-mix(in_oklab,var(--foreground)_10%,transparent),inset_0_1px_0_rgba(255,255,255,0.68)] transition-[box-shadow,transform] before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-card/55 before:backdrop-blur-[22px] before:backdrop-saturate-[1.14] before:content-[''] hover:-translate-y-0.5 hover:bg-transparent hover:shadow-[0_20px_54px_color-mix(in_oklab,var(--foreground)_13%,transparent),inset_0_1px_0_rgba(255,255,255,0.74)]"
                    aria-label="展开为正常聊天"
                  >
                    <Maximize2 className="h-4 w-4" />
                    <span>展开</span>
                  </Button>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-2xl text-foreground">继续当前 Timeline</div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">输入一句话，回到这段对话。</p>
                </div>
              )}
              <div className="story-continue-composer mx-auto w-full max-w-3xl">
                {contextPreviewQuery.isLoading ? <ChatComposerSkeleton /> : renderComposer({ centered: true })}
              </div>
            </div>
          )}
        </div>
      </div>

      {isRegularChatState ? (
        <div className="relative z-10 shrink-0 bg-transparent pb-5 pt-2">
          <div className="mx-auto w-full max-w-3xl px-3">
            {contextPreviewQuery.isLoading ? <ChatComposerSkeleton /> : renderComposer()}
          </div>
        </div>
      ) : null}
    </div>
  );
}
