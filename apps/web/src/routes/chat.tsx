import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { ChatImageAttachment, ChatMessage as ChatMessageType, SessionDetail, SessionSummary } from '@bubble-town/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Menu, MoreHorizontal, Paperclip, Plus, SendHorizonal, Square, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteSession as deleteHermesSession, fetchSessionDetail, fetchSessionSummary, fetchSessions, streamChat } from '@/lib/api/hermes';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { SessionList } from '@/components/hermes/session-list';
import { ChatMessage } from '@/components/hermes/chat-message';
import { ChatComposerSkeleton, ChatThreadSkeleton, LoadingLabel, SessionListSkeleton } from '@/components/loading/loading-state';
import { updateSessionDetail, updateSessionsPayload } from '@/routes/chat-cache';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
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

function logDeleteDebug(event: string, detail?: Record<string, unknown>) {
  if (!import.meta.env.DEV) {
    return;
  }

  console.debug('[chat-delete-debug]', event, detail ?? {});
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('无法读取图片数据。'));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('读取图片失败。'));
    };
    reader.readAsDataURL(file);
  });
}

export function ChatRoute() {
  const [draft, setDraft] = useState('');
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [sessionListOpen, setSessionListOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ChatImageAttachment[]>([]);
  const [streamingState, setStreamingState] = useState<StreamingState | null>(null);
  const actionsButtonRef = useRef<HTMLButtonElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const deleteConfirmTimeoutRef = useRef<number | null>(null);
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
    if (!activeSessionId) {
      logDeleteDebug('active-session-cleared', { routeSessionId });
      setDeleteConfirmOpen(false);
    }
  }, [activeSessionId, routeSessionId]);

  useEffect(() => {
    return () => {
      if (deleteConfirmTimeoutRef.current !== null) {
        window.clearTimeout(deleteConfirmTimeoutRef.current);
      }
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

  const shouldShowStreamingState = Boolean(streamingState && (!routeSessionId || streamingState.sessionId === routeSessionId));
  const persistedMessages = (sessionDetailQuery.data?.messages ?? []).filter((message) => message.role !== 'tool');
  const messages = shouldShowStreamingState && streamingState
    ? [...persistedMessages, streamingState.userMessage, streamingState.assistantMessage]
    : persistedMessages;
  const hasSessions = sessions.length > 0;
  const isSessionListLoading = sessionsQuery.isLoading;
  const isConversationLoading = Boolean(routeSessionId) && sessionDetailQuery.isLoading && !shouldShowStreamingState;

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
    setPendingAttachments([]);
    clearScheduledTitleRefresh();
    latestStreamingSessionRef.current = undefined;
    navigate('/chat');
    setSessionListOpen(false);
  }

  function scheduleDeleteConfirmOpen() {
    logDeleteDebug('schedule-delete-popover', {
      actionsMenuOpen,
      deleteConfirmOpen,
      activeSessionId,
    });
    if (deleteConfirmTimeoutRef.current !== null) {
      window.clearTimeout(deleteConfirmTimeoutRef.current);
    }

    deleteConfirmTimeoutRef.current = window.setTimeout(() => {
      logDeleteDebug('open-delete-popover-timeout-fired', {
        actionsMenuOpen,
        activeSessionId,
      });
      setDeleteConfirmOpen(true);
      deleteConfirmTimeoutRef.current = null;
    }, 0);
  }

  async function handleDeleteSession() {
    logDeleteDebug('confirm-delete-clicked', {
      activeSessionId,
      isPending: deleteSessionMutation.isPending,
      streamingStatus: streamingState?.status,
    });
    if (!activeSessionId || deleteSessionMutation.isPending || streamingState?.status === 'streaming') {
      logDeleteDebug('confirm-delete-aborted', {
        activeSessionId,
        isPending: deleteSessionMutation.isPending,
        streamingStatus: streamingState?.status,
      });
      return;
    }

    try {
      await deleteSessionMutation.mutateAsync({ sessionId: activeSessionId, profileId: activeProfileId });
      logDeleteDebug('delete-mutation-resolved', { activeSessionId, activeProfileId });
    } catch {
      logDeleteDebug('delete-mutation-rejected', { activeSessionId, activeProfileId });
      return;
    }
  }

  async function handleAttachmentInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }

    try {
      const attachments = await Promise.all(
        files
          .filter((file) => file.type.startsWith('image/'))
          .map(async (file) => ({
            type: 'image' as const,
            url: await readFileAsDataUrl(file),
            mimeType: file.type || undefined,
            name: file.name,
          })),
      );

      setPendingAttachments((current) => {
        const seen = new Set(current.map((attachment) => `${attachment.name ?? ''}|${attachment.url}`));
        const next = [...current];

        for (const attachment of attachments) {
          const identity = `${attachment.name ?? ''}|${attachment.url}`;
          if (!seen.has(identity)) {
            seen.add(identity);
            next.push(attachment);
          }
        }

        return next;
      });
    } finally {
      event.target.value = '';
    }
  }

  function handleRemovePendingAttachment(index: number) {
    setPendingAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function handleSend() {
    const input = draft.trim();
    const attachments = pendingAttachments;
    if ((!input && attachments.length === 0) || streamingState?.status === 'streaming') return;

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
        attachments,
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
        { input, attachments, profileId: activeProfileId, sessionId: requestSessionId, responseId: activeResponseId, mode: chatMode },
        {
          onStart: (event) => {
            latestStreamingSessionRef.current = event.sessionId;
            setDraft('');
            setPendingAttachments([]);
            setStreamingState((current) =>
              current
                ? {
                    ...current,
                    sessionId: event.sessionId,
                    responseId: event.responseId,
                  }
                : current,
            );
            navigate(`/chat/${encodeURIComponent(event.sessionId)}`, { replace: true });
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
        <div className="relative grid h-full min-h-0 flex-1 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
          <DrawerContent
            direction="left"
            portal={false}
            style={{ animationDuration: '0.24s', transitionDuration: '0.24s' }}
            className="fixed inset-y-0 left-[var(--sidebar-width)] flex h-screen w-[320px] max-w-[88vw] flex-col [animation-duration:240ms] [transition-duration:240ms] lg:hidden"
            overlayStyle={{ animationDuration: '0.24s', transitionDuration: '0.24s' }}
            overlayClassName="fixed inset-y-0 left-[var(--sidebar-width)] [animation-duration:240ms] [transition-duration:240ms] lg:hidden"
          >
            <DrawerHeader className="shrink-0 border-b border-border/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <DrawerTitle>会话列表</DrawerTitle>
                <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={handleNewConversation}>
                  <Plus className="h-4 w-4" />
                  <span className="ml-2">新建会话</span>
                </Button>
              </div>
            </DrawerHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
              {isSessionListLoading ? (
                <div className="space-y-3">
                  <LoadingLabel />
                  <SessionListSkeleton className="min-h-0 flex-1 max-h-none p-0" />
                </div>
              ) : (
                <SessionList
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  onSelect={handleSelectSession}
                  className="min-h-0 flex-1 max-h-none p-4"
                  emptyTitle="当前 profile 还没有会话"
                  emptyDescription="发送第一条消息后，会话会自动出现在这里。"
                />
              )}
            </div>
          </DrawerContent>

          <div className="hidden h-full min-h-0 overflow-hidden border-r border-border/70 bg-background lg:flex lg:flex-col">
            <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-6">
              <h2 className="text-base font-semibold tracking-tight">会话列表</h2>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={handleNewConversation}>
                <Plus className="h-4 w-4" />
                <span className="ml-2">新建会话</span>
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {isSessionListLoading ? (
                <div className="space-y-3 p-4">
                  <LoadingLabel />
                  <SessionListSkeleton className="min-h-0 flex-1 max-h-none p-0" />
                </div>
              ) : (
                <SessionList
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  onSelect={handleSelectSession}
                  className="min-h-0 flex-1 max-h-none p-3"
                  itemClassName='py-2 px-3'
                  contentClassName='space-y-1'
                  emptyTitle="当前 profile 还没有会话"
                  emptyDescription="发送第一条消息后，会话会自动出现在这里。"
                />
              )}
            </div>
          </div>

          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
            <div className="flex h-16 shrink-0 items-center border-b border-border/70 px-6">
              <div className="flex w-full flex-wrap items-center justify-between gap-3 align-center">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="lg:hidden">
                    <DrawerTrigger asChild>
                      <Button variant="outline" size="sm" className="rounded-xl">
                        <Menu className="h-4 w-4" />
                      </Button>
                    </DrawerTrigger>
                  </div>
                  <div className="space-y-2">
                    {isConversationLoading ? <Skeleton className="h-7 w-48" /> : <h2 className="text-lg font-semibold tracking-tight">{activeTitle}</h2>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {isConversationLoading ? <Skeleton className="h-9 w-9 rounded-xl" /> : null}
                  <Popover
                    open={deleteConfirmOpen}
                    onOpenChange={(open) => {
                      logDeleteDebug('popover-open-change', {
                        open,
                        actionsMenuOpen,
                        activeSessionId,
                      });
                      setDeleteConfirmOpen(open);
                    }}
                  >
                    <DropdownMenu
                      open={actionsMenuOpen}
                      onOpenChange={(open) => {
                        logDeleteDebug('actions-menu-open-change', {
                          open,
                          deleteConfirmOpen,
                          activeSessionId,
                        });
                        setActionsMenuOpen(open);
                        if (open) {
                          if (deleteConfirmTimeoutRef.current !== null) {
                            window.clearTimeout(deleteConfirmTimeoutRef.current);
                            deleteConfirmTimeoutRef.current = null;
                          }
                          setDeleteConfirmOpen(false);
                        }
                      }}
                    >
                      <DropdownMenuTrigger asChild>
                        <PopoverAnchor asChild>
                          <Button ref={actionsButtonRef} type="button" variant="outline" size="sm" className="rounded-xl">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">更多会话操作</span>
                          </Button>
                        </PopoverAnchor>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem
                          disabled={!activeSessionId || deleteSessionMutation.isPending || streamingState?.status === 'streaming'}
                          onSelect={() => {
                            logDeleteDebug('delete-menu-item-selected', {
                              activeSessionId,
                              actionsMenuOpen,
                              deleteConfirmOpen,
                            });
                            setActionsMenuOpen(false);
                            scheduleDeleteConfirmOpen();
                          }}
                          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                        >
                          删除会话
                        </DropdownMenuItem>
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
                    <PopoverContent
                      align="end"
                      className="space-y-3"
                      onOpenAutoFocus={() => {
                        logDeleteDebug('popover-open-auto-focus', { activeSessionId });
                      }}
                      onCloseAutoFocus={() => {
                        logDeleteDebug('popover-close-auto-focus', { activeSessionId });
                      }}
                      onInteractOutside={(event) => {
                        const target = event.target instanceof HTMLElement ? event.target.tagName : 'unknown';
                        const interactedWithActionsButton =
                          event.target instanceof Node && Boolean(actionsButtonRef.current?.contains(event.target));
                        logDeleteDebug('popover-interact-outside', {
                          target,
                          activeSessionId,
                          interactedWithActionsButton,
                        });
                        if (interactedWithActionsButton) {
                          event.preventDefault();
                          logDeleteDebug('popover-interact-outside-ignored', { activeSessionId });
                        }
                      }}
                      onEscapeKeyDown={() => {
                        logDeleteDebug('popover-escape-key-down', { activeSessionId });
                      }}
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-foreground">删除当前会话？</div>
                        <p className="text-xs leading-5 text-muted-foreground">
                          会同时清理这个 Hermes 会话对应的本地 transcript 与索引数据。
                        </p>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            logDeleteDebug('cancel-delete-clicked', { activeSessionId });
                            setDeleteConfirmOpen(false);
                          }}
                        >
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
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto bg-background/30 px-6 py-5">
                {isConversationLoading ? (
                  <div className="space-y-4">
                    <LoadingLabel className="mx-auto w-full max-w-3xl" />
                    <ChatThreadSkeleton />
                  </div>
                ) : (
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
                )}
              </div>

              <div className="shrink-0 bg-transparent pb-5 pt-2">
                {isConversationLoading ? (
                  <div className="space-y-3">
                    <LoadingLabel className="mx-auto max-w-3xl" />
                    <ChatComposerSkeleton />
                  </div>
                ) : (
                  <div className="mx-auto max-w-3xl">
                    <div className="rounded-[28px] border border-border/70 bg-secondary/20 shadow-xs transition-colors focus-within:border-ring/60">
                      <input
                        ref={attachmentInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(event) => void handleAttachmentInputChange(event)}
                      />
                      {pendingAttachments.length > 0 ? (
                        <div className="flex flex-wrap gap-3 px-4 pt-4">
                          {pendingAttachments.map((attachment, index) => (
                            <div key={`${attachment.url}-${index}`} className="group relative overflow-hidden rounded-2xl border border-border/70 bg-background/70">
                              <img
                                src={attachment.url}
                                alt={attachment.name ?? `待发送图片 ${index + 1}`}
                                className="h-20 w-20 object-cover"
                              />
                              <button
                                type="button"
                                onClick={() => handleRemovePendingAttachment(index)}
                                className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition hover:bg-background"
                                aria-label={`移除${attachment.name ?? `图片 ${index + 1}`}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <Textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder={activeSessionId ? '继续补充问题，或附上一张图片继续当前会话。' : '输入一条消息，或附上一张图片开始新的对话。'}
                        className="min-h-[2rem] rounded-[22px] border-0 bg-transparent p-4 shadow-none focus-visible:ring-0"
                      />
                      <div className="flex flex-col gap-3 px-2 pb-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-10 w-10 rounded-full p-0"
                            onClick={() => attachmentInputRef.current?.click()}
                            disabled={streamingState?.status === 'streaming'}
                            aria-label="添加图片附件"
                          >
                            <Paperclip className="h-4 w-4" />
                          </Button>
                          <p className="text-sm text-muted-foreground">
                            {pendingAttachments.length > 0 ? `已添加 ${pendingAttachments.length} 张图片，将随本条消息一起发送。` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {streamingState?.status === 'streaming' ? (
                            <Button variant="outline" onClick={handleStop} className="rounded-full">
                              停止生成
                              <Square className="ml-2 h-4 w-4 fill-current" />
                            </Button>
                          ) : null}
                          <Button
                            disabled={streamingState?.status === 'streaming' || (!draft.trim() && pendingAttachments.length === 0)}
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
                )}
              </div>
            </div>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
