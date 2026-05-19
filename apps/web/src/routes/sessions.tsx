import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Eye, Trash2, X } from 'lucide-react';
import { deleteSession, fetchSessions } from '@/lib/api/hermes';
import { PageTitlebar } from '@/components/layout/page-titlebar';
import { LoadingLabel, SessionListSkeleton } from '@/components/loading/loading-state';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { SessionList } from '@/components/hermes/session-list';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

export function SessionsRoute() {
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [summaryFilter, setSummaryFilter] = useState('all');
  const [bulkManageOpen, setBulkManageOpen] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const sessionsQuery = useQuery({
    queryKey: ['sessions-index', activeProfileId],
    queryFn: () => fetchSessions(activeProfileId),
  });
  const deleteSessionsMutation = useMutation({
    mutationFn: async ({ sessionIds, profileId }: { sessionIds: string[]; profileId?: string }) => {
      await Promise.all(sessionIds.map((sessionId) => deleteSession(sessionId, profileId)));
    },
    onSuccess: async (_result, variables) => {
      variables.sessionIds.forEach((sessionId) => {
        queryClient.removeQueries({ queryKey: ['session-detail', variables.profileId, sessionId] });
      });
      setSelectedSessionIds(new Set());
      setDeleteConfirmOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions-index'] }),
      ]);
    },
  });

  const sessions = useMemo(() => sessionsQuery.data?.sessions ?? [], [sessionsQuery.data?.sessions]);
  const sourceOptions = useMemo(() => Array.from(new Set(sessions.map((session) => session.source).filter(Boolean))).sort(), [sessions]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSessions = useMemo(() => {
    return [...sessions]
      .filter((session) => {
        if (sourceFilter !== 'all' && session.source !== sourceFilter) {
          return false;
        }

        if (summaryFilter === 'with-preview' && !session.lastMessagePreview) {
          return false;
        }

        if (summaryFilter === 'without-preview' && session.lastMessagePreview) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        return [session.title, session.lastMessagePreview, session.source].some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [normalizedQuery, sessions, sourceFilter, summaryFilter]);
  const selectedSessions = useMemo(
    () => sessions.filter((session) => selectedSessionIds.has(session.sessionId)),
    [selectedSessionIds, sessions],
  );
  const selectedVisibleCount = filteredSessions.filter((session) => selectedSessionIds.has(session.sessionId)).length;
  const allFilteredSelected = filteredSessions.length > 0 && selectedVisibleCount === filteredSessions.length;
  const isLoading = sessionsQuery.isLoading;
  const isDeleting = deleteSessionsMutation.isPending;

  function toggleSessionSelection(sessionId: string) {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }

  function toggleFilteredSelection() {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        filteredSessions.forEach((session) => next.delete(session.sessionId));
      } else {
        filteredSessions.forEach((session) => next.add(session.sessionId));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedSessionIds(new Set());
  }

  function enterBulkManage() {
    setBulkManageOpen(true);
  }

  function exitBulkManage() {
    setBulkManageOpen(false);
    clearSelection();
  }

  async function handleConfirmDelete() {
    if (selectedSessions.length === 0 || isDeleting) {
      return;
    }

    try {
      await deleteSessionsMutation.mutateAsync({
        sessionIds: selectedSessions.map((session) => session.sessionId),
        profileId: activeProfileId,
      });
    } catch {
      return;
    }
  }

  return (
    <div className="flex flex-col overflow-hidden h-full min-h-0">
      <PageTitlebar title={<h2 className="truncate text-base font-semibold tracking-tight">会话</h2>} />
      <div className="h-full space-y-4 overflow-auto p-4 lg:p-6">
      {isLoading ? (
        <div className="space-y-4">
          <LoadingLabel />
          <div className="grid gap-3 lg:grid-cols-[132px_minmax(0,1.6fr)_220px_220px]">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-1 w-1 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-1 w-1 rounded-full" />
            <Skeleton className="h-4 w-20" />
          </div>
          <SessionListSkeleton
            className="max-h-none p-0"
            contentClassName="space-y-2"
            itemClassName="p-4"
            count={8}
            showItemBorder
            showLastMessagePreview
            showActions
          />
        </div>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-[132px_minmax(0,1.6fr)_220px_220px]">
            {bulkManageOpen ? (
              <Button type="button" variant="outline" onClick={exitBulkManage} disabled={isDeleting} className="w-full">
                <X className="mr-2 h-4 w-4" />
                退出管理
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={enterBulkManage} disabled={filteredSessions.length === 0} className="w-full">
                <CheckSquare className="mr-2 h-4 w-4" />
                批量管理
              </Button>
            )}
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话标题、摘要或来源" />

            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger>
                <SelectValue placeholder="按来源筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部来源</SelectItem>
                {sourceOptions.map((source) => (
                  <SelectItem key={source} value={source}>
                    {source}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={summaryFilter} onValueChange={setSummaryFilter}>
              <SelectTrigger>
                <SelectValue placeholder="按摘要状态筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部摘要状态</SelectItem>
                <SelectItem value="with-preview">有摘要</SelectItem>
                <SelectItem value="without-preview">无摘要</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>当前 Profile 下共 {sessions.length} 条会话</span>
            <span className="h-1 w-1 rounded-full bg-border" />
            <span>筛选后显示 {filteredSessions.length} 条</span>
            <span className="h-1 w-1 rounded-full bg-border" />
            <span>{sourceOptions.length} 个来源</span>
          </div>

          {bulkManageOpen ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    disabled={filteredSessions.length === 0 || isDeleting}
                    onChange={toggleFilteredSelection}
                    className="h-4 w-4 rounded border-border"
                  />
                  <span>选择当前结果</span>
                </label>
                <span className="text-sm text-muted-foreground">
                  已选 {selectedSessions.length} 条
                  {selectedVisibleCount !== selectedSessions.length ? `，当前筛选中 ${selectedVisibleCount} 条` : ''}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedSessions.length > 0 ? (
                  <Button type="button" variant="outline" size="sm" onClick={clearSelection} disabled={isDeleting}>
                    取消选择
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={selectedSessions.length === 0 || isDeleting}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  删除所选
                </Button>
              </div>
            </div>
          ) : null}

          <SessionList
            sessions={filteredSessions}
            className="max-h-none"
            contentClassName="space-y-2"
            itemClassName="p-4"
            showItemBorder
            showLastMessagePreview
            onSelect={bulkManageOpen ? toggleSessionSelection : undefined}
            renderLeading={
              bulkManageOpen
                ? (session) => (
                    <input
                      type="checkbox"
                      aria-label={`选择会话 ${session.title}`}
                      checked={selectedSessionIds.has(session.sessionId)}
                      disabled={isDeleting}
                      onChange={() => toggleSessionSelection(session.sessionId)}
                      className="h-4 w-4 rounded border-border"
                    />
                )
                : undefined
            }
            renderActions={
              bulkManageOpen
                ? undefined
                : (session) => (
                    <Button asChild variant="secondary" size="sm">
                      <Link to={`/chat/${encodeURIComponent(session.sessionId)}`}>
                        <Eye className="mr-1 h-4 w-4" />
                        查看会话
                      </Link>
                    </Button>
                  )
            }
            emptyTitle={sessions.length === 0 ? '还没有历史会话' : '没有符合条件的会话'}
            emptyDescription={
              sessions.length === 0
                ? '先去聊天页发送第一条消息，这里会自动沉淀新的会话记录。'
                : '试试调整搜索词或筛选条件，列表会立即按当前条件重新计算。'
            }
          />

          <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>删除所选会话</DialogTitle>
                <DialogDescription>
                  将删除当前选中的 {selectedSessions.length} 条会话记录。此操作会移除本地会话文件，删除后无法在列表中恢复。
                </DialogDescription>
              </DialogHeader>
              {deleteSessionsMutation.isError ? <p className="text-sm text-destructive">删除失败，请稍后重试。</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={isDeleting}>
                  取消
                </Button>
                <Button type="button" onClick={handleConfirmDelete} disabled={selectedSessions.length === 0 || isDeleting}>
                  {isDeleting ? '删除中...' : '确认删除'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  </div>
  );
}
