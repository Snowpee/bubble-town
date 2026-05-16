import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage as ChatMessageType, SessionDetail, SessionSummary } from '@bubble-town/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Menu, MoreHorizontal, Plus, SendHorizonal, Square } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteSession as deleteHermesSession, fetchSessionDetail, fetchSessionSummary, fetchSessions, streamChat } from '@/lib/api/hermes';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { SessionList } from '@/components/hermes/session-list';
import { ChatMessage } from '@/components/hermes/chat-message';
import { updateSessionDetail, updateSessionsPayload } from '@/routes/chat-cache';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface StreamingState {
  sessionId?: string;
  responseId?: string;
  status: 'streaming' | 'error';
  userMessage: ChatMessageType;
  assistantMessage: ChatMessageType;
}

function upsertToolEvent(message: ChatMessageType, toolEvent: NonNullable<ChatMessageType['toolEvents']>[number]): ChatMessageType {
  const toolEvents = message.toolEvents ?? [];
  const index = toolEvents.findIndex((event) => event.id === toolEvent.id);
  const nextEvents = index === -1 ? [...toolEvents, toolEvent] : toolEvents.map((event, currentIndex) => (currentIndex === index ? toolEvent : event));

  return {
    ...message,
    toolEvents: nextEvents,
  };
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'AbortError';
  }

  return error instanceof Error && error.name === 'AbortError';
}

export function ChatRoute() {
  const [draft, setDraft] = useState('');
  const [sessionListOpen, setSessionListOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [streamingState, setStreamingState] = useState<StreamingState | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const latestStreamingSessionRef = useRef<string | undefined>(undefined);
  const activeSessionRef = useRef<string | undefined>(undefined);
  const titleRefreshTimeoutRef = useRef<number | null>(null);
  const titleRefreshTokenRef = useRef(0);
  const navigate = useNavigate();
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const queryClient = useQueryClient();
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const chatMode = useWorkspaceStore((state) => state.chatMode);
  const assistantMessageViewMode = useWorkspaceStore((state) => state.assistantMessageViewMode);
  const setAssistantMessageViewMode = useWorkspaceStore((state) => state.setAssistantMessageViewMode);
  const deleteSessionMutation = useMutation({
    mutationFn: ({ sessionId, profileId }: { sessionId: string; profileId?: string }) => deleteHermesSession(sessionId, profileId),
    onSuccess: async (_result, variables) => {
      abortControllerRef.current?.abort();
      setStreamingState(null);
      setDeleteConfirmOpen(false);
      clearScheduledTitleRefresh();
      latestStreamingSessionRef.current = undefined;
      queryClient.removeQueries({ queryKey: ['session-detail', variables.profileId, variables.sessionId] });
      if (activeSessionRef.current === variables.sessionId) {
        navigate('/chat', { replace: true });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions-index'] }),
        queryClient.invalidateQueries({ queryKey: ['session-detail'] }),
      ]);
    },
  });

  const sessionsQuery = useQuery({
    queryKey: ['sessions', activeProfileId],
    queryFn: () => fetchSessions(activeProfileId),
  });

  const sessionDetailQuery = useQuery({
    queryKey: ['session-detail', activeProfileId, routeSessionId],
    queryFn: () => fetchSessionDetail(routeSessionId!, activeProfileId),
    enabled: Boolean(routeSessionId),
  });

  const sessions = sessionsQuery.data?.sessions ?? [];
  const activeSessionId = sessionDetailQuery.data?.summary.sessionId ?? routeSessionId;
  const activeResponseId =
    sessionDetailQuery.data?.summary.responseId ??
    sessions.find((session) => session.sessionId === activeSessionId)?.responseId;

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    return () => {
      if (titleRefreshTimeoutRef.current !== null) {
        window.clearTimeout(titleRefreshTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!routeSessionId || !sessionDetailQuery.data?.summary.sessionId) {
      return;
    }

    if (sessionDetailQuery.data.summary.sessionId !== routeSessionId) {
      navigate(`/chat/${encodeURIComponent(sessionDetailQuery.data.summary.sessionId)}`, { replace: true });
    }
  }, [navigate, routeSessionId, sessionDetailQuery.data?.summary.sessionId]);

  const activeTitle = useMemo(() => {
    return (
      sessionDetailQuery.data?.summary.title ??
      sessions.find((session) => session.sessionId === activeSessionId)?.title ??
      '新对话'
    );
  }, [activeSessionId, sessionDetailQuery.data?.summary.title, sessions]);

  const persistedMessages = (sessionDetailQuery.data?.messages ?? []).filter((message) => message.role !== 'tool');
  const messages = streamingState ? [...persistedMessages, streamingState.userMessage, streamingState.assistantMessage] : persistedMessages;
  const hasSessions = sessions.length > 0;

  function handleSelectSession(sessionId: string) {
    titleRefreshTokenRef.current += 1;
    if (titleRefreshTimeoutRef.current !== null) {
      window.clearTimeout(titleRefreshTimeoutRef.current);
      titleRefreshTimeoutRef.current = null;
    }
    navigate(`/chat/${encodeURIComponent(sessionId)}`);
    setSessionListOpen(false);
  }

  async function refreshChatState(sessionId?: string) {
    if (sessionId) {
      navigate(`/chat/${encodeURIComponent(sessionId)}`, { replace: true });
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sessions'] }),
      queryClient.invalidateQueries({ queryKey: ['sessions-index'] }),
      queryClient.invalidateQueries({ queryKey: ['session-detail'] }),
    ]);
  }

  function clearScheduledTitleRefresh() {
    titleRefreshTokenRef.current += 1;
    if (titleRefreshTimeoutRef.current !== null) {
      window.clearTimeout(titleRefreshTimeoutRef.current);
      titleRefreshTimeoutRef.current = null;
    }
  }

  function mergeSessionSummaryIntoCache(summary: SessionSummary) {
    const profileKey = summary.profileId ?? activeProfileId;
    queryClient.setQueryData<{ sessions: SessionSummary[] }>(['sessions', profileKey], (payload) => updateSessionsPayload(payload, summary));
    queryClient.setQueryData<{ sessions: SessionSummary[] }>(['sessions-index', profileKey], (payload) =>
      updateSessionsPayload(payload, summary),
    );
    queryClient.setQueryData<SessionDetail>(['session-detail', profileKey, summary.sessionId], (current) =>
      updateSessionDetail(current, summary),
    );
  }

  async function refreshCurrentConversationTitle(sessionId: string) {
    const summary = await fetchSessionSummary(sessionId, activeProfileId);
    mergeSessionSummaryIntoCache(summary);
  }

  function scheduleTitleRefresh(sessionId: string) {
    clearScheduledTitleRefresh();
    const token = titleRefreshTokenRef.current;
    const delays = [800, 1_600, 3_200, 5_000];

    const runAttempt = (attemptIndex: number) => {
      titleRefreshTimeoutRef.current = window.setTimeout(() => {
        if (titleRefreshTokenRef.current !== token || activeSessionRef.current !== sessionId) {
          return;
        }

        void refreshCurrentConversationTitle(sessionId).catch(() => undefined).finally(() => {
          if (
            attemptIndex + 1 >= delays.length ||
            titleRefreshTokenRef.current !== token ||
            activeSessionRef.current !== sessionId
          ) {
            titleRefreshTimeoutRef.current = null;
            return;
          }

          runAttempt(attemptIndex + 1);
        });
      }, delays[attemptIndex]);
    };

    runAttempt(0);
  }

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  function handleNewConversation() {
    abortControllerRef.current?.abort();
    setStreamingState(null);
    clearScheduledTitleRefresh();
    latestStreamingSessionRef.current = undefined;
    navigate('/chat');
    setSessionListOpen(false);
  }

  async function handleDeleteSession() {
    if (!activeSessionId || deleteSessionMutation.isPending || streamingState?.status === 'streaming') {
      return;
    }

    try {
      await deleteSessionMutation.mutateAsync({ sessionId: activeSessionId, profileId: activeProfileId });
    } catch {
      return;
    }
  }

  async function handleSend() {
    const input = draft.trim();
    if (!input || streamingState?.status === 'streaming') return;

    const now = new Date().toISOString();
    const abortController = new AbortController();
    const startingSessionId = activeSessionId;
    const requestSessionId = activeSessionId;
    abortControllerRef.current = abortController;
    latestStreamingSessionRef.current = requestSessionId;
    clearScheduledTitleRefresh();

    setStreamingState({
      sessionId: requestSessionId,
      responseId: activeResponseId,
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
      const response = await streamChat(
        { input, profileId: activeProfileId, sessionId: requestSessionId, responseId: activeResponseId, mode: chatMode },
        {
          onStart: (event) => {
            latestStreamingSessionRef.current = event.sessionId;
            setDraft('');
            navigate(`/chat/${encodeURIComponent(event.sessionId)}`, { replace: true });
            setStreamingState((current) =>
              current
                ? {
                    ...current,
                    sessionId: event.sessionId,
                    responseId: event.responseId,
                  }
                : current,
            );
          },
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
                    assistantMessage: upsertToolEvent(current.assistantMessage, event),
                  }
                : current,
            );
          },
        },
        {
          signal: abortController.signal,
        },
      );

      await refreshChatState(response.sessionId);
      if (!startingSessionId && response.sessionId) {
        scheduleTitleRefresh(response.sessionId);
      }
      setStreamingState(null);
    } catch (error) {
      if (isAbortError(error)) {
        const abortedSessionId = latestStreamingSessionRef.current;
        await refreshChatState(abortedSessionId);
        if (!startingSessionId && abortedSessionId) {
          scheduleTitleRefresh(abortedSessionId);
        }
        setStreamingState(null);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <Drawer open={sessionListOpen} onOpenChange={setSessionListOpen} direction="left">
        <div className="relative grid h-full min-h-0 flex-1 overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
          <DrawerContent
            direction="left"
            portal={false}
            className="fixed inset-y-0 left-0 flex h-screen w-[320px] max-w-[88vw] flex-col xl:hidden lg:left-[var(--sidebar-width)]"
            overlayClassName="fixed inset-y-0 left-0 xl:hidden lg:left-[var(--sidebar-width)]"
          >
            <DrawerHeader className="shrink-0 border-b border-border/70 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <DrawerTitle>会话列表</DrawerTitle>
                <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={handleNewConversation}>
                  <Plus className="h-4 w-4" />
                  <span className="ml-2">新建会话</span>
                </Button>
              </div>
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
              <SessionList
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelect={handleSelectSession}
                className="min-h-0 flex-1 max-h-none"
                emptyTitle="当前 profile 还没有会话"
                emptyDescription="发送第一条消息后，会话会自动出现在这里。"
              />
            </div>
          </DrawerContent>

          <div className="hidden h-full min-h-0 overflow-hidden border-r border-border/70 bg-background xl:flex xl:flex-col">
            <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-6">
              <h2 className="text-base font-semibold tracking-tight">会话列表</h2>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={handleNewConversation}>
                <Plus className="h-4 w-4" />
                <span className="ml-2">新建会话</span>
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <SessionList
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelect={handleSelectSession}
                className="min-h-0 flex-1 max-h-none"
                emptyTitle="当前 profile 还没有会话"
                emptyDescription="发送第一条消息后，会话会自动出现在这里。"
              />
            </div>
          </div>

          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
            <div className="flex h-16 shrink-0 items-center border-b border-border/70 px-6">
              <div className="flex w-full flex-wrap items-center justify-between gap-3 align-center">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="xl:hidden">
                    <DrawerTrigger asChild>
                      <Button variant="outline" size="sm" className="rounded-xl">
                        <Menu className="h-4 w-4" />
                      </Button>
                    </DrawerTrigger>
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-lg font-semibold tracking-tight">{activeTitle}</h2>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="sm" className="rounded-xl">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">更多会话操作</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuSub open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                        <DropdownMenuSubTrigger
                          disabled={!activeSessionId || deleteSessionMutation.isPending || streamingState?.status === 'streaming'}
                          className="text-destructive focus:bg-destructive/10 focus:text-destructive data-[state=open]:bg-destructive/10 data-[state=open]:text-destructive"
                        >
                          删除会话
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-72 p-3">
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-foreground">删除当前会话？</div>
                              <p className="text-xs leading-5 text-muted-foreground">
                                会同时清理这个 Hermes 会话对应的本地 transcript 与索引数据。
                              </p>
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => setDeleteConfirmOpen(false)}>
                                取消
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => void handleDeleteSession()}
                                disabled={deleteSessionMutation.isPending}
                                className="bg-destructive text-destructive-foreground hover:opacity-90"
                              >
                                {deleteSessionMutation.isPending ? '删除中...' : '确认删除'}
                              </Button>
                            </div>
                          </div>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>消息样式</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-36">
                          <DropdownMenuRadioGroup
                            value={assistantMessageViewMode}
                            onValueChange={(value) => {
                              if (value === 'bubble' || value === 'document') {
                                setAssistantMessageViewMode(value);
                              }
                            }}
                          >
                            <DropdownMenuRadioItem value="bubble">对话气泡</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="document">文档式</DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto bg-background/30 px-6 py-5">
                <div className={cn('mx-auto flex w-full max-w-3xl flex-col gap-4')}>
                  {messages.length === 0 ? (
                    <div className="flex min-h-[360px] items-center justify-center rounded-3xl px-6 text-center">
                      <div className="max-w-md space-y-2">
                        <div className="text-lg font-medium text-foreground">{hasSessions && !activeSessionId ? '开始新会话' : '开始一段新的对话'}</div>
                        <p className="text-sm leading-6 text-muted-foreground">
                          {hasSessions && !activeSessionId
                            ? '发送消息开始新会话。或者，点击会话列表以继续之前的会话'
                            : '输入框会直接在当前 profile 下创建新会话，并把 assistant 的内容按流式增量写到界面。'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    messages.map((message) => (
                      <ChatMessage
                        key={message.id}
                        message={message}
                        assistantMessageViewMode={assistantMessageViewMode}
                        showToolActivity={message.id === streamingState?.assistantMessage.id}
                      />
                    ))
                  )}
                </div>
              </div>

              <div className="shrink-0 bg-transparent pb-5 pt-2">
                <div className="mx-auto max-w-3xl">
                  <div className="rounded-[28px] border border-border/70 bg-secondary/20 shadow-xs transition-colors focus-within:border-ring/60">
                    <Textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder={activeSessionId ? '继续补充问题，沿用当前会话上下文。' : '输入一条消息，开始新的对话。'}
                      className="min-h-[2rem] rounded-[22px] border-0 bg-transparent p-4 shadow-none focus-visible:ring-0"
                    />
                    <div className="flex flex-col gap-3 px-2 pb-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-muted-foreground"></p>
                      <div className="flex items-center gap-2">
                        {streamingState?.status === 'streaming' ? (
                          <Button variant="outline" onClick={handleStop} className="rounded-full">
                            停止生成
                            <Square className="ml-2 h-4 w-4 fill-current" />
                          </Button>
                        ) : null}
                        <Button
                          disabled={streamingState?.status === 'streaming' || !draft.trim()}
                          onClick={() => void handleSend()}
                          className="rounded-full"
                        >
                          {streamingState?.status === 'streaming' ? '生成中...' : '发送消息'}
                          <SendHorizonal className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
