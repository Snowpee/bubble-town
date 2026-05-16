import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchSessions } from '@/lib/api/hermes';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { SessionList } from '@/components/hermes/session-list';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function SessionsRoute() {
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [summaryFilter, setSummaryFilter] = useState('all');

  const sessionsQuery = useQuery({
    queryKey: ['sessions-index', activeProfileId],
    queryFn: () => fetchSessions(activeProfileId),
  });

  const sessions = sessionsQuery.data?.sessions ?? [];
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
  const hasFilters = normalizedQuery.length > 0 || sourceFilter !== 'all' || summaryFilter !== 'all';

  function resetFilters() {
    setQuery('');
    setSourceFilter('all');
    setSummaryFilter('all');
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">会话</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{sessions.length} 个会话</Badge>
          <Badge variant="secondary">{filteredSessions.length} 个结果</Badge>
          <Button asChild>
            <Link to="/chat">前往聊天页</Link>
          </Button>
        </div>
      </section>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            {hasFilters ? (
              <Button variant="outline" onClick={resetFilters}>
                清空筛选
              </Button>
            ) : null}
          </div>



          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_220px_220px]">
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

          <SessionList
            sessions={filteredSessions}
            className="max-h-none"
            emptyTitle={sessions.length === 0 ? '还没有历史会话' : '没有符合条件的会话'}
            emptyDescription={
              sessions.length === 0
                ? '先去聊天页发送第一条消息，这里会自动沉淀新的会话记录。'
                : '试试调整搜索词或筛选条件，列表会立即按当前条件重新计算。'
            }
          />
    </div>
  );
}
