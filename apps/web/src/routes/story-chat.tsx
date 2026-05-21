import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage as ChatMessageType } from '@bubble-town/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUp, Square } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ChatMessage } from '@/components/hermes/chat-message';
import { ChatComposerSkeleton, ChatThreadSkeleton, LoadingLabel } from '@/components/loading/loading-state';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { fetchActiveStoryline, previewContextPack, streamStorylineChat } from '@/lib/api/story';
import { useWorkspaceStore } from '@/lib/state/workspace-store';

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

export function StoryChatRoute() {
  const [draft, setDraft] = useState('');
  const [streamingState, setStreamingState] = useState<StreamingState | null>(null);
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

  const messages = streamingState
    ? [
        ...persistedMessages,
        streamingState.userMessage,
        streamingState.assistantMessage,
      ]
    : persistedMessages;

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

  if (activeStorylineQuery.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-6 py-5">
        <LoadingLabel className="mx-auto w-full max-w-3xl" />
        <ChatThreadSkeleton />
      </div>
    );
  }

  if (!activeStoryline) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">暂无可继续的剧情</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            当前还没有 active Storyline。初始 MVP 不开放历史、Profile 管理或高级设置入口。
          </p>
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => navigate('/')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-14 shrink-0 items-center border-b border-border/60 px-4">
        <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={() => navigate('/')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          返回
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-medium">{activeStoryline.title}</div>
        </div>
        <div className="w-16" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {contextPreviewQuery.isLoading && messages.length === 0 ? (
            <ChatThreadSkeleton />
          ) : messages.length === 0 ? (
            <div className="flex min-h-[360px] items-center justify-center text-center">
              <div className="space-y-2">
                <div className="text-2xl text-foreground">继续当前剧情</div>
                <p className="text-sm leading-6 text-muted-foreground">输入一句话，回到这段对话。</p>
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
        <div className="mx-auto w-full max-w-3xl px-3 sm:px-0">
          {contextPreviewQuery.isLoading ? (
            <ChatComposerSkeleton />
          ) : (
            <div className="rounded-[28px] border border-border/70 bg-secondary/20 shadow-xs transition-colors focus-within:border-ring/60">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="继续当前剧情"
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
                  variant="default"
                  disabled={streamingState?.status === 'streaming' || !draft.trim()}
                  onClick={() => void handleSend()}
                  className="h-10 w-10 rounded-full p-0"
                >
                  <ArrowUp className="h-5 w-5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
