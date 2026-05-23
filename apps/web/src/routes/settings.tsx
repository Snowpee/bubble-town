import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Database,
  EyeOff,
  History,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  DEFAULT_PROFILE_ID,
  type ActivityLog,
  type MemoryKind,
  type MemoryRecord,
  type MemorySource,
  type ProfilesResponse,
  type RuntimeRecordStatus,
} from '@bubble-town/shared';
import { fetchHealth } from '@/lib/api/hermes';
import { PageTitlebar } from '@/components/layout/page-titlebar';
import { LoadingLabel, SettingsPanelSkeleton, StatusCardSkeleton } from '@/components/loading/loading-state';
import { markActiveProfileInResponse } from '@/lib/api/profile-cache';
import { fetchProfiles, prepareProfileForStoryline, resetProfileForStoryline, switchProfile } from '@/lib/api/profiles';
import {
  activateStorylineForProfile,
  consolidateStorylineMemory,
  correctMemory,
  createCharacter,
  createStoryline,
  fetchActiveStoryline,
  fetchActivityLogs,
  fetchStorylineMemories,
  fetchStorylines,
  hideMemory,
  restoreMemory,
} from '@/lib/api/story';
import { logProfileDebug } from '@/lib/debug/profile-debug';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { companionThemeOptions, type CompanionThemeName } from '@/lib/companion-theme';
import { StatusCard } from '@/components/hermes/status-card';
import { SETTINGS_ALL_FILTER_VALUE, filterSettingsMemories } from './settings-memory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const ALL_VALUE = SETTINGS_ALL_FILTER_VALUE;

function formatDateTime(value?: string) {
  if (!value) {
    return '未记录';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPercent(value?: number) {
  if (typeof value !== 'number') {
    return '未知';
  }

  return `${Math.round(value * 100)}%`;
}

function statusVariant(status: RuntimeRecordStatus) {
  if (status === 'active') {
    return 'default';
  }

  return status === 'hidden' ? 'secondary' : 'outline';
}

function findActivitiesByIds(activityLogs: ActivityLog[], ids?: string[]) {
  if (!ids?.length) {
    return [];
  }

  const idSet = new Set(ids);
  return activityLogs.filter((activityLog) => idSet.has(activityLog.id));
}

function MemoryMetaGrid({ memory }: { memory: MemoryRecord }) {
  const items = [
    ['类型', memory.kind ?? 'unclassified'],
    ['来源', memory.source],
    ['生命周期', memory.lifespan ?? 'long_term'],
    ['重要性', formatPercent(memory.importance)],
    ['置信度', formatPercent(memory.confidence)],
    ['访问次数', String(memory.accessCount ?? 0)],
    ['上次访问', formatDateTime(memory.lastAccessedAt)],
    ['过期时间', formatDateTime(memory.expiresAt)],
  ];

  return (
    <dl className="grid gap-2 text-xs sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border/60 bg-background/35 px-3 py-2">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="mt-1 truncate font-medium text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function WorldStateMeta({ memory }: { memory: MemoryRecord }) {
  if (!memory.worldState) {
    return null;
  }

  const items = [
    ['sceneId', memory.worldState.sceneId],
    ['objectId', memory.worldState.objectId],
    ['state', memory.worldState.state],
    ['version', String(memory.worldState.version)],
  ];

  return (
    <div className="rounded-xl border border-border/70 bg-background/35 p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">World State Metadata</div>
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border/60 bg-background/35 px-3 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 truncate font-mono text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

interface MemoryDetailProps {
  memory: MemoryRecord;
  activityLogs: ActivityLog[];
  allMemories: MemoryRecord[];
  onCorrect: (memory: MemoryRecord) => void;
  onHide: (memory: MemoryRecord) => void;
  onRestore: (memory: MemoryRecord) => void;
  actionPending: boolean;
}

function MemoryDetail({ memory, activityLogs, allMemories, onCorrect, onHide, onRestore, actionPending }: MemoryDetailProps) {
  const sourceActivities = findActivitiesByIds(activityLogs, memory.sourceActivityIds);
  const supersedes = allMemories.filter((candidate) => memory.supersedes?.includes(candidate.id));
  const supersededBy = allMemories.find((candidate) => candidate.id === memory.supersededBy);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusVariant(memory.status)}>{memory.status}</Badge>
            <Badge variant="secondary">{memory.kind ?? 'unclassified'}</Badge>
            <Badge variant="outline">{memory.source}</Badge>
          </div>
          <p className="max-w-3xl text-sm leading-7 text-foreground">{memory.content}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onCorrect(memory)} disabled={actionPending}>
            纠正
          </Button>
          {memory.status === 'active' ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onHide(memory)} disabled={actionPending}>
              <EyeOff className="mr-2 h-4 w-4" />
              隐藏
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => onRestore(memory)} disabled={actionPending}>
              <RotateCcw className="mr-2 h-4 w-4" />
              恢复
            </Button>
          )}
        </div>
      </div>

      <MemoryMetaGrid memory={memory} />
      <WorldStateMeta memory={memory} />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-background/35 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">来源消息</div>
          <div className="space-y-1 text-xs text-foreground">
            {(memory.sourceMessageIds ?? []).length > 0 ? (
              memory.sourceMessageIds?.map((id) => <div key={id} className="truncate font-mono">{id}</div>)
            ) : (
              <div className="text-muted-foreground">无 sourceMessageIds</div>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/35 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">巩固来源 ActivityLog</div>
          <div className="space-y-2">
            {sourceActivities.length > 0 ? (
              sourceActivities.map((activityLog) => (
                <div key={activityLog.id} className="rounded-lg bg-card/55 px-3 py-2 text-xs leading-5">
                  <div className="text-foreground">{activityLog.summary}</div>
                  <div className="mt-1 text-muted-foreground">{formatDateTime(activityLog.happenedAt)}</div>
                </div>
              ))
            ) : (
              <div className="text-xs text-muted-foreground">无 sourceActivityIds</div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-background/35 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">Supersedes 链路</div>
        <div className="grid gap-2 text-xs lg:grid-cols-2">
          <div>
            <div className="mb-1 text-muted-foreground">替代了</div>
            {supersedes.length > 0 ? supersedes.map((item) => <div key={item.id} className="truncate text-foreground">{item.content}</div>) : <div className="text-muted-foreground">无</div>}
          </div>
          <div>
            <div className="mb-1 text-muted-foreground">被替代为</div>
            {supersededBy ? <div className="truncate text-foreground">{supersededBy.content}</div> : <div className="text-muted-foreground">无</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsRoute() {
  const navigate = useNavigate();
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const chatMode = useWorkspaceStore((state) => state.chatMode);
  const companionTheme = useWorkspaceStore((state) => state.companionTheme);
  const setActiveProfileId = useWorkspaceStore((state) => state.setActiveProfileId);
  const setActiveStorylineId = useWorkspaceStore((state) => state.setActiveStorylineId);
  const setChatMode = useWorkspaceStore((state) => state.setChatMode);
  const setCompanionTheme = useWorkspaceStore((state) => state.setCompanionTheme);
  const queryClient = useQueryClient();
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(undefined);
  const [memoryStatusFilter, setMemoryStatusFilter] = useState<string>(ALL_VALUE);
  const [memoryKindFilter, setMemoryKindFilter] = useState<string>(ALL_VALUE);
  const [memorySourceFilter, setMemorySourceFilter] = useState<string>(ALL_VALUE);
  const [memoryLinkFilter, setMemoryLinkFilter] = useState<string>(ALL_VALUE);
  const [memorySearch, setMemorySearch] = useState('');
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | undefined>(undefined);
  const [correctionTarget, setCorrectionTarget] = useState<MemoryRecord | null>(null);
  const [correctionContent, setCorrectionContent] = useState('');
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState('');

  const healthQuery = useQuery({ queryKey: ['health'], queryFn: fetchHealth });
  const profilesQuery = useQuery({ queryKey: ['profiles-settings'], queryFn: fetchProfiles });
  const storylinesQuery = useQuery({ queryKey: ['storylines'], queryFn: fetchStorylines });
  const activeStorylineQuery = useQuery({ queryKey: ['active-storyline'], queryFn: fetchActiveStoryline });
  const activeStoryline = activeStorylineQuery.data?.activeStoryline;
  const profiles = profilesQuery.data?.profiles ?? [];
  const currentProfileId = profilesQuery.data?.activeProfileId ?? activeProfileId ?? DEFAULT_PROFILE_ID;
  const effectiveSelectedProfileId = selectedProfileId ?? currentProfileId;
  const selectedProfile = profiles.find((profile) => profile.id === effectiveSelectedProfileId);
  const existingSelectedStoryline = (storylinesQuery.data?.storylines ?? []).find(
    (storyline) => storyline.hermesProfileId === effectiveSelectedProfileId && storyline.status === 'active',
  );

  const memoriesQuery = useQuery({
    queryKey: ['storyline-memories', activeStoryline?.id],
    queryFn: () => fetchStorylineMemories(activeStoryline!.id),
    enabled: Boolean(activeStoryline?.id),
  });
  const activityLogsQuery = useQuery({
    queryKey: ['storyline-activity', activeStoryline?.id],
    queryFn: () => fetchActivityLogs(activeStoryline!.id),
    enabled: Boolean(activeStoryline?.id),
  });

  const memories = memoriesQuery.data?.memories ?? [];
  const activityLogs = activityLogsQuery.data?.activityLogs ?? [];
  const memoryKinds = Array.from(new Set(memories.map((memory) => memory.kind ?? 'unclassified'))).sort();
  const memorySources = Array.from(new Set(memories.map((memory) => memory.source))).sort();
  const summaryMemories = memories.filter((memory) => memory.source === 'summary');
  const duplicateKeepers = memories.filter((memory) => (memory.supersedes?.length ?? 0) > 0);
  const hiddenDuplicates = memories.filter((memory) => memory.status === 'hidden' && Boolean(memory.supersededBy));
  const replacementMemories = memories.filter((memory) => (memory.supersedes?.length ?? 0) > 0 && memory.source !== 'summary');

  const filteredMemories = useMemo(() => {
    return filterSettingsMemories(memories, {
      status: memoryStatusFilter,
      kind: memoryKindFilter,
      source: memorySourceFilter,
      link: memoryLinkFilter,
      search: memorySearch,
    });
  }, [memories, memoryKindFilter, memoryLinkFilter, memorySearch, memorySourceFilter, memoryStatusFilter]);

  const selectedMemory = memories.find((memory) => memory.id === selectedMemoryId) ?? filteredMemories[0];

  const invalidateStorylineState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['active-storyline'] }),
      queryClient.invalidateQueries({ queryKey: ['storylines'] }),
      queryClient.invalidateQueries({ queryKey: ['storyline-memories'] }),
      queryClient.invalidateQueries({ queryKey: ['storyline-activity'] }),
      queryClient.invalidateQueries({ queryKey: ['context-preview'] }),
    ]);
  };

  const switchProfileMutation = useMutation({
    mutationFn: (profileId: string) => {
      logProfileDebug('settings-switch-request', {
        currentActiveProfileId: activeProfileId,
        requestedProfileId: profileId,
      });
      return switchProfile(profileId);
    },
    onSuccess: async (result) => {
      const nextProfileId = result.activeProfile?.id ?? DEFAULT_PROFILE_ID;
      logProfileDebug('settings-switch-success', {
        previousActiveProfileId: activeProfileId,
        nextProfileId,
        returnedActiveProfileId: result.activeProfile?.id,
        returnedSessionProfiles: Array.from(new Set(result.sessions.map((session) => session.profileId))),
      });
      queryClient.setQueryData<ProfilesResponse>(['profiles'], (payload) => markActiveProfileInResponse(payload, nextProfileId, result.activeProfile));
      queryClient.setQueryData<ProfilesResponse>(['profiles-page'], (payload) => markActiveProfileInResponse(payload, nextProfileId, result.activeProfile));
      queryClient.setQueryData<ProfilesResponse>(['profiles-settings'], (payload) => markActiveProfileInResponse(payload, nextProfileId, result.activeProfile));
      setActiveProfileId(nextProfileId);
      const storylineResult = await activateStorylineForProfile(nextProfileId);
      setActiveStorylineId(storylineResult.activeStoryline?.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profiles'] }),
        queryClient.invalidateQueries({ queryKey: ['profiles-page'] }),
        queryClient.invalidateQueries({ queryKey: ['profiles-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions-index'] }),
        invalidateStorylineState(),
      ]);
    },
    onError: (error, requestedProfileId) => {
      logProfileDebug('settings-switch-error', {
        requestedProfileId,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const initializeStorylineMutation = useMutation({
    mutationFn: async () => {
      const profileId = effectiveSelectedProfileId || DEFAULT_PROFILE_ID;
      const existingStoryline = (storylinesQuery.data?.storylines ?? []).find(
        (storyline) => storyline.hermesProfileId === profileId && storyline.status === 'active',
      );
      if (existingStoryline) {
        const result = await activateStorylineForProfile(profileId);
        return result.activeStoryline ?? existingStoryline;
      }

      await prepareProfileForStoryline(profileId);
      const character = await createCharacter({
        name: selectedProfile?.name ? `${selectedProfile.name} 角色` : '默认角色',
        templateProfileId: profileId,
        description: '初始 MVP 调试角色',
      });
      return createStoryline({
        characterId: character.id,
        hermesProfileId: profileId,
        title: selectedProfile?.name ? `${selectedProfile.name} 当前 Timeline` : '当前 Timeline',
        description: '由设置中心创建',
      });
    },
    onSuccess: async (storyline) => {
      setActiveStorylineId(storyline.id);
      await invalidateStorylineState();
    },
  });

  const hideMemoryMutation = useMutation({
    mutationFn: (memoryId: string) => hideMemory(memoryId),
    onSuccess: () => invalidateStorylineState(),
  });

  const restoreMemoryMutation = useMutation({
    mutationFn: (memoryId: string) => restoreMemory(memoryId),
    onSuccess: () => invalidateStorylineState(),
  });

  const correctMemoryMutation = useMutation({
    mutationFn: ({ memoryId, content }: { memoryId: string; content: string }) => correctMemory(memoryId, { content }),
    onSuccess: async (result) => {
      setCorrectionTarget(null);
      setCorrectionContent('');
      setSelectedMemoryId(result.replacement.id);
      await invalidateStorylineState();
    },
  });

  const consolidateMutation = useMutation({
    mutationFn: () => consolidateStorylineMemory(activeStoryline!.id),
    onSuccess: () => invalidateStorylineState(),
  });

  const resetProfileMutation = useMutation({
    mutationFn: async () => {
      const profileId = effectiveSelectedProfileId || DEFAULT_PROFILE_ID;
      return resetProfileForStoryline(profileId, resetConfirmation.trim());
    },
    onSuccess: async (result) => {
      setResetDialogOpen(false);
      setResetConfirmation('');
      setSelectedMemoryId(undefined);
      if (activeStoryline?.hermesProfileId === result.profileId) {
        setActiveStorylineId(undefined);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profiles'] }),
        queryClient.invalidateQueries({ queryKey: ['profiles-page'] }),
        queryClient.invalidateQueries({ queryKey: ['profiles-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions-index'] }),
        invalidateStorylineState(),
      ]);
    },
  });

  const actionPending = hideMemoryMutation.isPending || restoreMemoryMutation.isPending || correctMemoryMutation.isPending;
  const operationError =
    switchProfileMutation.error
    ?? initializeStorylineMutation.error
    ?? hideMemoryMutation.error
    ?? restoreMemoryMutation.error
    ?? correctMemoryMutation.error
    ?? consolidateMutation.error
    ?? resetProfileMutation.error;

  function openCorrection(memory: MemoryRecord) {
    setCorrectionTarget(memory);
    setCorrectionContent(memory.content);
  }

  return (
    <div className="companion-page companion-page--interior flex h-full min-h-0 flex-col overflow-hidden">
      <div className="companion-aura companion-aura--main" aria-hidden="true" />
      <div className="companion-aura companion-aura--lower" aria-hidden="true" />
      <PageTitlebar
        className="companion-chat-panel relative z-10 border-b-0"
        title={
          <div className="flex min-w-0 items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/')} className="h-8 w-8 rounded-full p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="truncate text-base font-semibold tracking-tight">设置中心</h2>
          </div>
        }
      />

      <div className="relative z-10 min-h-0 flex-1 overflow-auto px-4 pb-6 pt-3 lg:px-6">
        <Tabs defaultValue="general" className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <TabsList className="grid h-auto w-full grid-cols-4 gap-1 bg-white/42 p-1 backdrop-blur-xl">
            <TabsTrigger value="general" className="gap-2">
              <Settings className="h-4 w-4" />
              General
            </TabsTrigger>
            <TabsTrigger value="memory" className="gap-2">
              <Database className="h-4 w-4" />
              Memory
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-2">
              <History className="h-4 w-4" />
              Audit
            </TabsTrigger>
            <TabsTrigger value="diagnostics" className="gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Diagnostics
            </TabsTrigger>
          </TabsList>

          {operationError ? (
            <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {operationError instanceof Error ? operationError.message : '设置操作失败。'}
            </div>
          ) : null}

          <TabsContent value="general" className="grid gap-4 lg:grid-cols-2">
            <section className="companion-glass rounded-2xl p-4">
              <div className="mb-4">
                <div className="text-sm font-medium">当前 Timeline</div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">普通聊天仍以当前 Storyline 为主；设置中心只负责维护入口。</p>
              </div>
              <div className="space-y-3">
                <Select
                  value={effectiveSelectedProfileId}
                  onValueChange={(value) => setSelectedProfileId(value)}
                  disabled={profilesQuery.isLoading || profiles.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择 Profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!effectiveSelectedProfileId || switchProfileMutation.isPending}
                    onClick={() => switchProfileMutation.mutate(effectiveSelectedProfileId)}
                  >
                    切换 Profile
                  </Button>
                  <Button
                    type="button"
                    disabled={!effectiveSelectedProfileId || initializeStorylineMutation.isPending}
                    onClick={() => initializeStorylineMutation.mutate()}
                  >
                    {existingSelectedStoryline ? '激活 Timeline' : '初始化 Timeline'}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!effectiveSelectedProfileId || resetProfileMutation.isPending}
                    onClick={() => {
                      setResetConfirmation('');
                      setResetDialogOpen(true);
                    }}
                  >
                    重置
                  </Button>
                </div>
                <div className="rounded-xl border border-border/70 bg-background/35 p-3 text-sm leading-6">
                  <div className="font-medium text-foreground">{activeStoryline?.title ?? '暂无当前 Timeline'}</div>
                  <div className="mt-1 text-muted-foreground">Profile：{activeStoryline?.hermesProfileId ?? effectiveSelectedProfileId}</div>
                </div>
              </div>
            </section>

            <section className="companion-glass rounded-2xl p-4">
              <div className="mb-4 text-sm font-medium">界面与协议</div>
              <div className="grid gap-3">
                <Select value={companionTheme} onValueChange={(value) => setCompanionTheme(value as CompanionThemeName)}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择界面主题" />
                  </SelectTrigger>
                  <SelectContent>
                    {companionThemeOptions.map((theme) => (
                      <SelectItem key={theme.value} value={theme.value}>
                        {theme.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={chatMode} onValueChange={(value: 'responses' | 'chat-completions') => setChatMode(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择 Hermes 协议模式" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="responses">responses</SelectItem>
                    <SelectItem value="chat-completions">chat-completions</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm leading-6 text-muted-foreground">后续模型配置、外观细节和高级运行选项应继续落在页面级 Settings，而不是首页 popover。</p>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="memory" className="grid min-h-[520px] gap-4 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.4fr)]">
            <section className="companion-glass flex min-h-0 flex-col rounded-2xl p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Memory Records</div>
                  <div className="text-xs text-muted-foreground">{filteredMemories.length} / {memories.length}</div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => memoriesQuery.refetch()} disabled={!activeStoryline || memoriesQuery.isFetching}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  刷新
                </Button>
              </div>
              <div className="grid gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={memorySearch} onChange={(event) => setMemorySearch(event.target.value)} placeholder="搜索内容、原因或类型" className="bg-card/60 pl-9" />
                </div>
                <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                  <Select value={memoryStatusFilter} onValueChange={setMemoryStatusFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>全部状态</SelectItem>
                      <SelectItem value="active">active</SelectItem>
                      <SelectItem value="hidden">hidden</SelectItem>
                      <SelectItem value="deleted">deleted</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={memoryKindFilter} onValueChange={setMemoryKindFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>全部类型</SelectItem>
                      {memoryKinds.map((kind) => <SelectItem key={kind} value={kind}>{kind}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={memorySourceFilter} onValueChange={setMemorySourceFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>全部来源</SelectItem>
                      {memorySources.map((source) => <SelectItem key={source} value={source}>{source}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={memoryLinkFilter} onValueChange={setMemoryLinkFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>全部链路</SelectItem>
                      <SelectItem value="superseded">被替代</SelectItem>
                      <SelectItem value="supersedes">替代其它</SelectItem>
                      <SelectItem value="unlinked">无链路</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                {memoriesQuery.isLoading ? (
                  <SettingsPanelSkeleton />
                ) : filteredMemories.length > 0 ? (
                  filteredMemories.map((memory) => (
                    <button
                      key={memory.id}
                      type="button"
                      onClick={() => setSelectedMemoryId(memory.id)}
                      className={cn(
                        'w-full rounded-xl border p-3 text-left transition-colors',
                        selectedMemory?.id === memory.id ? 'border-primary/45 bg-primary/10' : 'border-border/70 bg-card/45 hover:bg-card/70',
                      )}
                    >
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        <Badge variant={statusVariant(memory.status)}>{memory.status}</Badge>
                        <Badge variant="outline">{memory.kind ?? 'unclassified'}</Badge>
                      </div>
                      <div className="line-clamp-2 text-sm leading-6 text-foreground">{memory.content}</div>
                      <div className="mt-2 text-xs text-muted-foreground">更新于 {formatDateTime(memory.updatedAt)}</div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-xl border border-border/70 bg-card/45 p-4 text-sm text-muted-foreground">当前筛选下没有记忆。</div>
                )}
              </div>
            </section>

            <section className="companion-glass min-h-0 overflow-auto rounded-2xl p-4">
              {activeStoryline ? (
                selectedMemory ? (
                  <MemoryDetail
                    memory={selectedMemory}
                    activityLogs={activityLogs}
                    allMemories={memories}
                    onCorrect={openCorrection}
                    onHide={(memory) => hideMemoryMutation.mutate(memory.id)}
                    onRestore={(memory) => restoreMemoryMutation.mutate(memory.id)}
                    actionPending={actionPending}
                  />
                ) : (
                  <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">选择一条记忆查看详情。</div>
                )
              ) : (
                <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">需要先初始化当前 Timeline。</div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="audit" className="grid gap-4 lg:grid-cols-3">
            <section className="companion-glass rounded-2xl p-4 lg:col-span-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">自动巩固审计</div>
                  <p className="mt-1 text-sm text-muted-foreground">查看 summary memory、ActivityLog 来源和 supersedes 链路。</p>
                </div>
                <Button type="button" disabled={!activeStoryline || consolidateMutation.isPending} onClick={() => consolidateMutation.mutate()}>
                  <Activity className="mr-2 h-4 w-4" />
                  手动巩固
                </Button>
              </div>
            </section>

            <section className="companion-glass rounded-2xl p-4">
              <div className="mb-3 text-sm font-medium">Summary Memory</div>
              <div className="space-y-2">
                {summaryMemories.length > 0 ? summaryMemories.map((memory) => (
                  <div key={memory.id} className="rounded-xl border border-border/70 bg-card/45 p-3">
                    <div className="text-sm leading-6">{memory.content}</div>
                    <div className="mt-2 text-xs text-muted-foreground">来源 ActivityLog：{memory.sourceActivityIds?.length ?? 0}</div>
                  </div>
                )) : <div className="text-sm text-muted-foreground">暂无 summary memory。</div>}
              </div>
            </section>

            <section className="companion-glass rounded-2xl p-4">
              <div className="mb-3 text-sm font-medium">重复合并链路</div>
              <div className="space-y-2">
                {duplicateKeepers.length > 0 ? duplicateKeepers.map((memory) => (
                  <div key={memory.id} className="rounded-xl border border-border/70 bg-card/45 p-3">
                    <div className="text-sm leading-6">{memory.content}</div>
                    <div className="mt-2 text-xs text-muted-foreground">supersedes：{memory.supersedes?.length ?? 0}</div>
                  </div>
                )) : <div className="text-sm text-muted-foreground">暂无合并 keeper。</div>}
              </div>
            </section>

            <section className="companion-glass rounded-2xl p-4">
              <div className="mb-3 text-sm font-medium">Hidden / Replacement</div>
              <div className="space-y-2">
                {[...hiddenDuplicates, ...replacementMemories].length > 0 ? [...hiddenDuplicates, ...replacementMemories].map((memory) => (
                  <div key={memory.id} className="rounded-xl border border-border/70 bg-card/45 p-3">
                    <div className="flex gap-2">
                      <Badge variant={statusVariant(memory.status)}>{memory.status}</Badge>
                      <Badge variant="outline">{memory.source}</Badge>
                    </div>
                    <div className="mt-2 text-sm leading-6">{memory.content}</div>
                    <div className="mt-2 text-xs text-muted-foreground">supersededBy：{memory.supersededBy ?? '无'}</div>
                  </div>
                )) : <div className="text-sm text-muted-foreground">暂无 replacement 或 hidden duplicate。</div>}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="diagnostics" className="grid gap-4 lg:grid-cols-2">
            {healthQuery.isLoading ? (
              <>
                <div className="lg:col-span-2"><LoadingLabel /></div>
                <StatusCardSkeleton />
              </>
            ) : (
              (healthQuery.data?.items ?? []).map((item) => <StatusCard key={item.key} item={item} />)
            )}
            <section className="companion-glass rounded-2xl p-4 text-sm leading-6 text-muted-foreground lg:col-span-2">
              <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                当前探测到的连接信息
              </div>
              <div>Hermes 根目录：{healthQuery.data?.detected.hermesRoot ?? '未探测到'}</div>
              <div>API Server：{healthQuery.data?.detected.apiBaseUrl ?? '未探测到'}</div>
            </section>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={Boolean(correctionTarget)} onOpenChange={(open) => {
        if (!open) {
          setCorrectionTarget(null);
        }
      }}>
        <DialogContent className="bg-card/95 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>纠正记忆</DialogTitle>
            <DialogDescription>系统会创建 replacement memory，并隐藏旧记忆以保留审计链。</DialogDescription>
          </DialogHeader>
          <Textarea
            value={correctionContent}
            onChange={(event) => setCorrectionContent(event.target.value)}
            className="min-h-32 bg-secondary/60"
            placeholder="输入新的准确记忆"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCorrectionTarget(null)}>取消</Button>
            <Button
              type="button"
              disabled={!correctionTarget || !correctionContent.trim() || correctMemoryMutation.isPending}
              onClick={() => {
                if (correctionTarget) {
                  correctMemoryMutation.mutate({ memoryId: correctionTarget.id, content: correctionContent.trim() });
                }
              }}
            >
              确认纠正
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetDialogOpen} onOpenChange={(open) => {
        setResetDialogOpen(open);
        if (!open) {
          setResetConfirmation('');
        }
      }}>
        <DialogContent className="bg-card/95 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>重置 Profile</DialogTitle>
            <DialogDescription>
              该操作会清空此 Profile 对应的 Bubble Town Timeline 运行数据，并清理 Hermes 目录中的会话、状态库和日志，然后重写为项目要求的初始配置。
              <br />
              请输入 profile 名称 <span className="font-medium text-foreground">{effectiveSelectedProfileId ?? DEFAULT_PROFILE_ID}</span> 以确认执行。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={resetConfirmation}
            onChange={(event) => setResetConfirmation(event.target.value)}
            placeholder={`输入 ${effectiveSelectedProfileId ?? DEFAULT_PROFILE_ID} 确认`}
            className="bg-secondary/60"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResetDialogOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                !effectiveSelectedProfileId
                || resetConfirmation.trim() !== effectiveSelectedProfileId
                || resetProfileMutation.isPending
              }
              onClick={() => resetProfileMutation.mutate()}
            >
              确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
