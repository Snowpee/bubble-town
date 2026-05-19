import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { DEFAULT_PROFILE_ID, type ChatImageAttachment, type ChatMessage as ChatMessageType, type SessionDetail, type SessionSummary } from '@bubble-town/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ArrowUpToLine, MoreHorizontal, Paperclip, SendHorizonal, Square, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteSession as deleteHermesSession, fetchSessionDetail, fetchSessionSummary, fetchSessions, streamChat } from '@/lib/api/hermes';
import { logProfileDebug } from '@/lib/debug/profile-debug';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { ChatMessage } from '@/components/hermes/chat-message';
import { PageTitlebar } from '@/components/layout/page-titlebar';
import { ChatComposerSkeleton, ChatThreadSkeleton, LoadingLabel } from '@/components/loading/loading-state';
import { appendMessagesToSessionDetail, updateSessionDetail, updateSessionsPayload } from '@/routes/chat-cache';
import { Button } from '@/components/ui/button';
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
  const streamingStateRef = useRef<StreamingState | null>(null);
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

  const isStreamingRouteSession = Boolean(routeSessionId && streamingState?.status === 'streaming' && streamingState.sessionId === routeSessionId);
  const sessionDetailQuery = useQuery({
    queryKey: ['session-detail', activeProfileId, routeSessionId],
    queryFn: () => fetchSessionDetail(routeSessionId!, activeProfileId),
    enabled: Boolean(routeSessionId) && !isStreamingRouteSession,
  });

  const sessions = useMemo(() => sessionsQuery.data?.sessions ?? [], [sessionsQuery.data?.sessions]);
  const activeSessionId = sessionDetailQuery.data?.summary.sessionId ?? routeSessionId;
  const activeResponseId =
    sessionDetailQuery.data?.summary.responseId ??
    sessions.find((session) => session.sessionId === activeSessionId)?.responseId;

  useEffect(() => {
    if (!sessionsQuery.data) {
      return;
    }

    logProfileDebug('chat-sessions-loaded', {
      activeProfileId,
      count: sessions.length,
      sessionProfiles: Array.from(new Set(sessions.map((session) => session.profileId))),
      firstSessionId: sessions[0]?.sessionId,
    });
  }, [activeProfileId, sessions, sessionsQuery.data]);

  useEffect(() => {
    if (!sessionDetailQuery.data) {
      return;
    }

    logProfileDebug('chat-session-detail-loaded', {
      activeProfileId,
      routeSessionId,
      summarySessionId: sessionDetailQuery.data.summary.sessionId,
      summaryProfileId: sessionDetailQuery.data.summary.profileId,
      responseId: sessionDetailQuery.data.summary.responseId,
    });
  }, [activeProfileId, routeSessionId, sessionDetailQuery.data]);

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    streamingStateRef.current = streamingState;
  }, [streamingState]);

  useEffect(() => {
    if (!activeSessionId) {
      logDeleteDebug('active-session-cleared', { routeSessionId });
      setDeleteConfirmOpen(false);
    }
  }, [activeSessionId, routeSessionId]);

  useEffect(() => {
    if (routeSessionId) {
      return;
    }

    abortControllerRef.current?.abort();
    setStreamingState(null);
    setPendingAttachments([]);
    clearScheduledTitleRefresh();
    latestStreamingSessionRef.current = undefined;
  }, [routeSessionId]);

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
    ? [
        ...persistedMessages.filter(
          (message) => message.id !== streamingState.userMessage.id && message.id !== streamingState.assistantMessage.id,
        ),
        streamingState.userMessage,
        streamingState.assistantMessage,
      ]
    : persistedMessages;
  const hasSessions = sessions.length > 0;
  const hasActiveSession = Boolean(activeSessionId);
  const isNewConversationState = !hasActiveSession && messages.length === 0;
  const emptyConversationVisualOffset = '-translate-y-10 sm:-translate-y-16 lg:-translate-y-24 xl:-translate-y-36';
  const isConversationLoading = Boolean(routeSessionId) && sessionDetailQuery.isLoading && !shouldShowStreamingState;

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

  function seedCompletedStreamingDetail(response: { sessionId: string; responseId?: string }) {
    const completedState = streamingStateRef.current;
    if (!completedState || completedState.sessionId !== response.sessionId) {
      return;
    }

    const profileKey = activeProfileId;
    const summary =
      sessionDetailQuery.data?.summary ??
      sessions.find((session) => session.sessionId === response.sessionId) ??
      {
        sessionId: response.sessionId,
        conversation: response.sessionId,
        id: response.sessionId,
        responseId: response.responseId,
        profileId: activeProfileId ?? DEFAULT_PROFILE_ID,
        title: completedState.userMessage.content.trim().slice(0, 64) || '新对话',
        source: 'api-server',
        startedAt: completedState.userMessage.createdAt,
        updatedAt: completedState.assistantMessage.createdAt,
        messageCount: 0,
        lastMessagePreview: completedState.assistantMessage.content,
      };

    const completedMessages = [
      completedState.userMessage,
      completedState.assistantMessage,
    ];

    queryClient.setQueryData<SessionDetail>(['session-detail', profileKey, response.sessionId], (current) =>
      appendMessagesToSessionDetail(current ?? { summary, messages: persistedMessages }, completedMessages, response.responseId),
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

  function renderChatComposer() {
    return (
      <div className="mx-auto w-full max-w-3xl px-3 sm:px-0">
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
                variant="default"
                disabled={streamingState?.status === 'streaming' || (!draft.trim() && pendingAttachments.length === 0)}
                onClick={() => void handleSend()}
                className="rounded-full w-10 h-10 p-0"
              >
                <ArrowUp className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
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
    const requestProfileId = activeProfileId;
    const requestResponseId = activeResponseId;
    logProfileDebug('chat-send-start', {
      activeProfileId,
      requestProfileId,
      routeSessionId,
      activeSessionId,
      requestSessionId,
      activeResponseId,
      chatMode,
      hasAttachments: attachments.length > 0,
    });
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
        { input, attachments, profileId: requestProfileId, sessionId: requestSessionId, responseId: requestResponseId, mode: chatMode },
        {
          onStart: (event) => {
            logProfileDebug('chat-stream-start', {
              requestProfileId,
              routeSessionId,
              requestedSessionId: requestSessionId,
              returnedSessionId: event.sessionId,
              returnedResponseId: event.responseId,
            });
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
          onComplete: (event) => {
            logProfileDebug('chat-stream-complete-event', {
              requestProfileId,
              requestedSessionId: requestSessionId,
              returnedSessionId: event.sessionId,
              returnedResponseId: event.responseId,
            });
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

      logProfileDebug('chat-send-complete', {
        requestProfileId,
        requestedSessionId: requestSessionId,
        returnedSessionId: response.sessionId,
        returnedResponseId: response.responseId,
        model: response.model,
      });
      seedCompletedStreamingDetail(response);
      setStreamingState(null);
      void refreshChatState(response.sessionId);
      if (!startingSessionId && response.sessionId) {
        scheduleTitleRefresh(response.sessionId);
      }
    } catch (error) {
      if (isAbortError(error)) {
        const abortedSessionId = latestStreamingSessionRef.current;
        if (abortedSessionId) {
          seedCompletedStreamingDetail({ sessionId: abortedSessionId, responseId: streamingStateRef.current?.responseId });
        }
        setStreamingState(null);
        void refreshChatState(abortedSessionId);
        if (!startingSessionId && abortedSessionId) {
          scheduleTitleRefresh(abortedSessionId);
        }
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
      <div className="relative h-full min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
            <PageTitlebar
              title={isConversationLoading ? <Skeleton className="h-7 w-48" /> : hasActiveSession ? <h2 className="truncate font-semibold tracking-tight">{activeTitle}</h2> : null}
              titleClassName="flex min-w-0 items-center"
              actions={
                <>
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
                          <Button ref={actionsButtonRef} type="button" variant="ghost" size="sm" className="rounded-xl">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">更多会话操作</span>
                          </Button>
                        </PopoverAnchor>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44 border-none ring-1 ring-foreground/5">
                        {hasActiveSession ? (
                          <DropdownMenuItem
                            disabled={deleteSessionMutation.isPending || streamingState?.status === 'streaming'}
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
                        ) : null}
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
                </>
              }
            />

            <div className="flex min-h-0 flex-1 flex-col">
              <div className={cn('min-h-0 flex-1 overflow-y-auto bg-background/30 px-6 py-5', isNewConversationState && 'flex items-center')}>
                {isConversationLoading ? (
                  <div className="space-y-4">
                    <LoadingLabel className="mx-auto w-full max-w-3xl" />
                    <ChatThreadSkeleton />
                  </div>
                ) : isNewConversationState ? (
                  <div className={cn('mx-auto flex w-full max-w-3xl flex-col items-center gap-8 transition-transform duration-100 ease-out', emptyConversationVisualOffset)}>
                    <div className="w-full max-w-md space-y-2 text-center">
                      <div className="text-2xl text-foreground">{hasSessions ? '开始新会话' : '开始一段新的对话'}</div>
                      <p className="mx-auto max-w-[30ch] break-words text-sm leading-6 text-muted-foreground sm:max-w-md">
                        {hasSessions
                          ? null
                          : '输入框会直接在当前 profile 下创建新会话，并把 assistant 的内容按流式增量写到界面。'}
                      </p>
                    </div>
                    {renderChatComposer()}
                  </div>
                ) : (
                  <div className={cn('mx-auto flex w-full max-w-3xl flex-col gap-4')}>
                    {messages.length === 0 ? (
                    <div className={cn('flex min-h-[360px] items-center justify-center rounded-3xl px-4 text-center transition-transform duration-100 ease-out', emptyConversationVisualOffset)}>
                      <div className="w-full max-w-md space-y-2">
                        <div className="text-2xl text-foreground">{hasSessions && !activeSessionId ? '开始新会话' : '开始一段新的对话'}</div>
                        <p className="mx-auto max-w-[30ch] break-words text-sm leading-6 text-muted-foreground sm:max-w-md">
                          {hasSessions && !activeSessionId
                            ? null
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

              {isNewConversationState ? null : (
                <div className="shrink-0 bg-transparent pb-5 pt-2">
                  {isConversationLoading ? (
                    <div className="space-y-3">
                      <LoadingLabel className="mx-auto max-w-3xl" />
                      <ChatComposerSkeleton />
                    </div>
                  ) : (
                    renderChatComposer()
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
    </div>
  );
}
