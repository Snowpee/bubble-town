import { useEffect, useMemo, useRef, useState } from 'react';
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
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  type AuxiliaryLlmAuditEntry,
  type AuxiliaryLlmSettings,
  type AuxiliaryLlmSettingsResponse,
  type TestAuxiliaryLlmConnectionResponse,
  type UpdateAuxiliaryLlmSettingsRequest,
  DEFAULT_PROFILE_ID,
  type ActivityLog,
  type MemoryKind,
  type MemoryRecord,
  type MemorySource,
  type ProfilesResponse,
  type RuntimeRecordStatus,
} from '@bubble-town/shared';
import { fetchHealth } from '@/lib/api/hermes';
import {
  fetchAuxiliaryLlmSettings,
  testAuxiliaryLlmConnection,
  updateAuxiliaryLlmSettings,
} from '@/lib/api/config';
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const ALL_VALUE = SETTINGS_ALL_FILTER_VALUE;

type SettingsSectionId = 'general' | 'memory' | 'audit' | 'diagnostics';

interface SettingsSectionDefinition {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
}

const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Profile、主题、Auxiliary LLM',
    icon: Settings,
  },
  {
    id: 'memory',
    label: 'Memory',
    description: '过滤、审阅与修正记忆',
    icon: Database,
  },
  {
    id: 'audit',
    label: 'Audit',
    description: 'Summary、合并链路与审计',
    icon: History,
  },
  {
    id: 'diagnostics',
    label: 'Diagnostics',
    description: '健康检查与连接探测',
    icon: SlidersHorizontal,
  },
];

const SETTINGS_SURFACE_RADIUS = 'rounded-[var(--settings-surface-radius)]';
const SETTINGS_INNER_RADIUS = 'rounded-[var(--settings-inner-radius)]';

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

function toAuxiliaryLlmDraft(settings: AuxiliaryLlmSettings): UpdateAuxiliaryLlmSettingsRequest {
  return {
    profileId: settings.profileId,
    enabled: settings.enabled,
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    thinkingEnabled: settings.thinkingEnabled,
    reasoningEffort: settings.reasoningEffort,
    defaultTimeoutMs: settings.defaultTimeoutMs,
    useFor: settings.useFor,
  };
}

function formatAuxiliaryAudit(entry?: AuxiliaryLlmAuditEntry) {
  if (!entry) {
    return '未记录';
  }
  return `${entry.status === 'success' ? '成功' : '失败'} · ${entry.taskType} · ${formatDateTime(entry.happenedAt)}`;
}

function createAuxiliaryLlmDraft(profileId: string): UpdateAuxiliaryLlmSettingsRequest {
  return {
    profileId,
    enabled: false,
    provider: 'openai-compatible',
    baseUrl: '',
    model: '',
    thinkingEnabled: false,
    reasoningEffort: 'high',
    defaultTimeoutMs: 15000,
    useFor: ['world-state'],
  };
}

function isDeepSeekAuxiliaryDraft(input: Pick<UpdateAuxiliaryLlmSettingsRequest, 'baseUrl' | 'model'>) {
  return /deepseek/i.test(input.baseUrl) || /deepseek/i.test(input.model);
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
        <div key={label} className={cn(SETTINGS_INNER_RADIUS, 'border border-border/60 bg-background/35 px-3 py-2')}>
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
    <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-background/35 p-3')}>
      <div className="mb-2 text-xs font-medium text-muted-foreground">World State Metadata</div>
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        {items.map(([label, value]) => (
          <div key={label} className={cn(SETTINGS_INNER_RADIUS, 'border border-border/60 bg-background/35 px-3 py-2')}>
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
        <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-background/35 p-3')}>
          <div className="mb-2 text-xs font-medium text-muted-foreground">来源消息</div>
          <div className="space-y-1 text-xs text-foreground">
            {(memory.sourceMessageIds ?? []).length > 0 ? (
              memory.sourceMessageIds?.map((id) => <div key={id} className="truncate font-mono">{id}</div>)
            ) : (
              <div className="text-muted-foreground">无 sourceMessageIds</div>
            )}
          </div>
        </div>
        <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-background/35 p-3')}>
          <div className="mb-2 text-xs font-medium text-muted-foreground">巩固来源 ActivityLog</div>
          <div className="space-y-2">
            {sourceActivities.length > 0 ? (
              sourceActivities.map((activityLog) => (
                <div key={activityLog.id} className={cn(SETTINGS_INNER_RADIUS, 'bg-card/55 px-3 py-2 text-xs leading-5')}>
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

      <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-background/35 p-3')}>
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

function SettingsCard({
  title,
  description,
  className,
  children,
}: React.PropsWithChildren<{ title: string; description?: string; className?: string }>) {
  return (
    <section className={cn('companion-glass p-4 md:p-5', SETTINGS_SURFACE_RADIUS, className)}>
      <div className="mb-4">
        <div className="text-sm font-medium">{title}</div>
        {description ? (
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

interface SettingsSidebarNavProps {
  activeSection: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  selectedStorylineTitle?: string;
}

function SettingsSidebarNav({
  activeSection,
  onSectionChange,
  selectedStorylineTitle,
}: SettingsSidebarNavProps) {
  const { isMobile, setOpenMobile } = useSidebar();

  const handleSectionSelect = (section: SettingsSectionId) => {
    onSectionChange(section);
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {SETTINGS_SECTIONS.map((section) => {
                const Icon = section.icon;
                return (
                  <SidebarMenuItem key={section.id}>
                    <SidebarMenuButton
                      type="button"
                      size="lg"
                      tooltip={section.label}
                      isActive={activeSection === section.id}
                      onClick={() => handleSectionSelect(section.id)}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                        <div className="font-medium">{section.label}</div>
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className={cn(SETTINGS_INNER_RADIUS, 'border border-sidebar-border/70 bg-white/8 px-3 py-3 text-xs leading-5 text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden')}>
          <div className="font-medium text-sidebar-foreground">当前 Timeline</div>
          <div className="mt-1">{selectedStorylineTitle ?? '尚未初始化'}</div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </>
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
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general');
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
  const [auxiliaryDraft, setAuxiliaryDraft] = useState<UpdateAuxiliaryLlmSettingsRequest>(() => createAuxiliaryLlmDraft(DEFAULT_PROFILE_ID));
  const [auxiliaryApiKeyInput, setAuxiliaryApiKeyInput] = useState('');
  const [auxiliaryTestResult, setAuxiliaryTestResult] = useState<TestAuxiliaryLlmConnectionResponse | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [shouldCollapseSidebar, setShouldCollapseSidebar] = useState(false);
  const [showFloatingSectionHeader, setShowFloatingSectionHeader] = useState(false);
  const sectionScrollRef = useRef<HTMLDivElement | null>(null);
  const sectionHeroRef = useRef<HTMLDivElement | null>(null);

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
  const selectedStoryline = activeStoryline?.hermesProfileId === effectiveSelectedProfileId
    ? activeStoryline
    : existingSelectedStoryline;

  const memoriesQuery = useQuery({
    queryKey: ['storyline-memories', selectedStoryline?.id],
    queryFn: () => fetchStorylineMemories(selectedStoryline!.id),
    enabled: Boolean(selectedStoryline?.id),
  });
  const activityLogsQuery = useQuery({
    queryKey: ['storyline-activity', selectedStoryline?.id],
    queryFn: () => fetchActivityLogs(selectedStoryline!.id),
    enabled: Boolean(selectedStoryline?.id),
  });
  const auxiliaryLlmSettingsQuery = useQuery({
    queryKey: ['auxiliary-llm-settings', effectiveSelectedProfileId],
    queryFn: () => fetchAuxiliaryLlmSettings(effectiveSelectedProfileId || DEFAULT_PROFILE_ID),
  });

  const memories = selectedStoryline ? (memoriesQuery.data?.memories ?? []) : [];
  const activityLogs = selectedStoryline ? (activityLogsQuery.data?.activityLogs ?? []) : [];
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

  const selectedMemory = memories.find((memory) => memory.id === selectedMemoryId) ?? null;
  const auxiliarySettings = auxiliaryLlmSettingsQuery.data?.settings;
  const auxiliaryStatus = auxiliaryLlmSettingsQuery.data?.status;
  const showDeepSeekControls = isDeepSeekAuxiliaryDraft(auxiliaryDraft);
  const activeSectionMeta = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0];

  useEffect(() => {
    const profileId = effectiveSelectedProfileId || DEFAULT_PROFILE_ID;
    if (auxiliaryLlmSettingsQuery.data) {
      setAuxiliaryDraft(toAuxiliaryLlmDraft(auxiliaryLlmSettingsQuery.data.settings));
    } else {
      setAuxiliaryDraft(createAuxiliaryLlmDraft(profileId));
    }
    setAuxiliaryApiKeyInput('');
    setAuxiliaryTestResult(null);
  }, [auxiliaryLlmSettingsQuery.data, effectiveSelectedProfileId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const syncSidebarCollapse = () => setShouldCollapseSidebar(mediaQuery.matches);
    syncSidebarCollapse();
    mediaQuery.addEventListener('change', syncSidebarCollapse);
    return () => mediaQuery.removeEventListener('change', syncSidebarCollapse);
  }, []);

  useEffect(() => {
    if (shouldCollapseSidebar) {
      setSidebarOpen(false);
      return;
    }

    setSidebarOpen(true);
  }, [shouldCollapseSidebar]);

  useEffect(() => {
    setSelectedMemoryId(undefined);
  }, [effectiveSelectedProfileId, selectedStoryline?.id]);

  useEffect(() => {
    setShowFloatingSectionHeader(false);
    const node = sectionScrollRef.current;
    if (node) {
      node.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [activeSection]);

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
    mutationFn: () => consolidateStorylineMemory(selectedStoryline!.id),
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
      if (selectedStoryline?.hermesProfileId === result.profileId) {
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
  const auxiliarySettingsMutation = useMutation({
    mutationFn: async () => updateAuxiliaryLlmSettings({
      ...auxiliaryDraft,
      profileId: effectiveSelectedProfileId || DEFAULT_PROFILE_ID,
      apiKey: auxiliaryApiKeyInput.trim() ? auxiliaryApiKeyInput.trim() : undefined,
    }),
    onSuccess: (response) => {
      queryClient.setQueryData(['auxiliary-llm-settings', response.settings.profileId], response);
      setAuxiliaryDraft(toAuxiliaryLlmDraft(response.settings));
      setAuxiliaryApiKeyInput('');
    },
  });
  const clearAuxiliaryApiKeyMutation = useMutation({
    mutationFn: async () => updateAuxiliaryLlmSettings({
      ...auxiliaryDraft,
      profileId: effectiveSelectedProfileId || DEFAULT_PROFILE_ID,
      clearApiKey: true,
    }),
    onSuccess: (response) => {
      queryClient.setQueryData(['auxiliary-llm-settings', response.settings.profileId], response);
      setAuxiliaryDraft(toAuxiliaryLlmDraft(response.settings));
      setAuxiliaryApiKeyInput('');
      setAuxiliaryTestResult({
        ok: true,
        message: '已清空 API Key。',
      });
    },
  });
  const auxiliaryTestMutation = useMutation({
    mutationFn: async () => testAuxiliaryLlmConnection({
      ...auxiliaryDraft,
      profileId: effectiveSelectedProfileId || DEFAULT_PROFILE_ID,
      apiKey: auxiliaryApiKeyInput.trim() ? auxiliaryApiKeyInput.trim() : undefined,
    }),
    onSuccess: (result) => {
      setAuxiliaryTestResult(result);
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
    ?? resetProfileMutation.error
    ?? auxiliarySettingsMutation.error
    ?? clearAuxiliaryApiKeyMutation.error
    ?? auxiliaryTestMutation.error;

  function openCorrection(memory: MemoryRecord) {
    setCorrectionTarget(memory);
    setCorrectionContent(memory.content);
  }

  function handleSectionScroll() {
    const scrollNode = sectionScrollRef.current;
    const heroNode = sectionHeroRef.current;
    if (!scrollNode || !heroNode) {
      return;
    }

    const scrollRect = scrollNode.getBoundingClientRect();
    const heroRect = heroNode.getBoundingClientRect();
    const nextVisible = heroRect.bottom <= scrollRect.top;
    setShowFloatingSectionHeader((current) => (current === nextVisible ? current : nextVisible));
  }

  const ActiveSectionIcon = activeSectionMeta.icon;

  const sectionContent = (() => {
    if (activeSection === 'general') {
      return (
        <div className="space-y-4">
          <SettingsCard
            title="当前 Timeline"
            description="普通聊天仍以当前 Storyline 为主；设置中心只负责维护入口。"
          >
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

              <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-background/35 p-3 text-sm leading-6')}>
                <div className="font-medium text-foreground">{selectedStoryline?.title ?? '暂无当前 Timeline'}</div>
                <div className="mt-1 text-muted-foreground">
                  Profile：{selectedStoryline?.hermesProfileId ?? effectiveSelectedProfileId}
                </div>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard title="界面与协议" description="继续沿用页面级 Settings，不把高级运行参数塞回首页入口。">
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

              <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-background/35 p-3 text-sm leading-6 text-muted-foreground')}>
                主题色、玻璃感和 sidebar 配色都继续走项目现有 token，不引入独立的 Settings 视觉体系。
              </div>
            </div>
          </SettingsCard>

          <SettingsCard
            title="Auxiliary LLM"
            description="用于 world-state 等产品级派生任务；不接管主聊天。当前配置按 Profile 生效。"
            className="lg:col-span-2"
          >
            <div className="grid gap-3">
              <Select
                value={auxiliaryDraft.enabled ? 'enabled' : 'disabled'}
                onValueChange={(value) => setAuxiliaryDraft((current) => ({ ...current, enabled: value === 'enabled' }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择启用状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="enabled">启用</SelectItem>
                  <SelectItem value="disabled">禁用</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={auxiliaryDraft.provider}
                onValueChange={(value) => setAuxiliaryDraft((current) => ({ ...current, provider: value as 'openai-compatible' }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择 Provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai-compatible">OpenAI Compatible</SelectItem>
                </SelectContent>
              </Select>

              <Input
                value={auxiliaryDraft.baseUrl}
                onChange={(event) => setAuxiliaryDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                placeholder="https://api.example.com/v1"
                className="bg-card/60"
              />
              <Input
                value={auxiliaryDraft.model}
                onChange={(event) => setAuxiliaryDraft((current) => ({ ...current, model: event.target.value }))}
                placeholder="gpt-4.1-mini"
                className="bg-card/60"
              />

              {showDeepSeekControls ? (
                <>
                  <Select
                    value={auxiliaryDraft.thinkingEnabled ? 'enabled' : 'disabled'}
                    onValueChange={(value) => setAuxiliaryDraft((current) => ({ ...current, thinkingEnabled: value === 'enabled' }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择 Thinking 模式" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="enabled">Thinking Enabled</SelectItem>
                      <SelectItem value="disabled">Thinking Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                  {auxiliaryDraft.thinkingEnabled ? (
                    <Select
                      value={auxiliaryDraft.reasoningEffort}
                      onValueChange={(value) => setAuxiliaryDraft((current) => ({
                        ...current,
                        reasoningEffort: value as 'high' | 'max',
                      }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择 Reasoning Effort" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">reasoning_effort: high</SelectItem>
                        <SelectItem value="max">reasoning_effort: max</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}
                </>
              ) : null}

              <Input
                type="password"
                value={auxiliaryApiKeyInput}
                onChange={(event) => setAuxiliaryApiKeyInput(event.target.value)}
                placeholder={auxiliarySettings?.apiKeyConfigured ? '已保存 API Key，留空表示保留' : '输入 API Key'}
                className="bg-card/60"
              />
              <Input
                type="number"
                min={1000}
                step={1000}
                value={String(auxiliaryDraft.defaultTimeoutMs)}
                onChange={(event) => setAuxiliaryDraft((current) => ({
                  ...current,
                  defaultTimeoutMs: Number(event.target.value) || current.defaultTimeoutMs,
                }))}
                placeholder="15000"
                className="bg-card/60"
              />

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={auxiliarySettingsMutation.isPending || clearAuxiliaryApiKeyMutation.isPending || auxiliaryLlmSettingsQuery.isLoading}
                  onClick={() => auxiliarySettingsMutation.mutate()}
                >
                  保存设置
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!auxiliarySettings?.apiKeyConfigured || clearAuxiliaryApiKeyMutation.isPending || auxiliarySettingsMutation.isPending}
                  onClick={() => clearAuxiliaryApiKeyMutation.mutate()}
                >
                  清空 API Key
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={auxiliaryTestMutation.isPending || clearAuxiliaryApiKeyMutation.isPending || auxiliaryLlmSettingsQuery.isLoading}
                  onClick={() => auxiliaryTestMutation.mutate()}
                >
                  {auxiliaryTestMutation.isPending ? '测试中...' : 'Test Connection'}
                </Button>
              </div>

              <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-background/35 p-3 text-sm leading-6')}>
                <div className="font-medium text-foreground">最近状态</div>
                <div className="mt-1 text-muted-foreground">密钥：{auxiliarySettings?.apiKeyConfigured ? '已配置' : '未配置'}</div>
                <div className="text-muted-foreground">用途：{auxiliarySettings?.useFor.join(', ') || 'world-state'}</div>
                <div className="text-muted-foreground">Thinking：{auxiliarySettings?.thinkingEnabled ? 'enabled' : 'disabled'}</div>
                {auxiliarySettings?.thinkingEnabled ? (
                  <div className="text-muted-foreground">Reasoning Effort：{auxiliarySettings.reasoningEffort}</div>
                ) : null}
                <div className="text-muted-foreground">最近正式调用：{formatAuxiliaryAudit(auxiliaryStatus?.lastInvocation)}</div>
                <div className="text-muted-foreground">最近错误：{auxiliaryStatus?.lastError ? auxiliaryStatus.lastError.message : '无'}</div>
                <div className={cn('mt-2', auxiliaryTestResult?.ok ? 'text-primary' : 'text-muted-foreground')}>
                  {auxiliaryTestResult ? auxiliaryTestResult.message : '尚未测试连接。'}
                </div>
              </div>
            </div>
          </SettingsCard>
        </div>
      );
    }

    if (activeSection === 'memory') {
      return (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SettingsCard title="总记忆数" className="p-4">
              <div className="text-3xl font-semibold tracking-tight">{memories.length}</div>
              <div className="mt-1 text-sm text-muted-foreground">当前 Timeline 下的全部 MemoryRecord</div>
            </SettingsCard>
            <SettingsCard title="Summary" className="p-4">
              <div className="text-3xl font-semibold tracking-tight">{summaryMemories.length}</div>
              <div className="mt-1 text-sm text-muted-foreground">自动巩固产生的 summary memory</div>
            </SettingsCard>
            <SettingsCard title="隐藏记忆" className="p-4">
              <div className="text-3xl font-semibold tracking-tight">{hiddenDuplicates.length}</div>
              <div className="mt-1 text-sm text-muted-foreground">已隐藏且仍保留审计链路</div>
            </SettingsCard>
            <SettingsCard title="替代链路" className="p-4">
              <div className="text-3xl font-semibold tracking-tight">{duplicateKeepers.length}</div>
              <div className="mt-1 text-sm text-muted-foreground">存在 supersedes 关系的 keeper</div>
            </SettingsCard>
          </div>

          <SettingsCard
            title="Memory Records"
            description="列表留在主区域，二级详情改为弹窗查看，避免在设置页维护嵌套布局。"
          >
            {selectedStoryline ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">{filteredMemories.length} / {memories.length}</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => memoriesQuery.refetch()}
                    disabled={memoriesQuery.isFetching}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    刷新
                  </Button>
                </div>

                <div className="mt-4 grid gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={memorySearch}
                      onChange={(event) => setMemorySearch(event.target.value)}
                      placeholder="搜索内容、原因或类型"
                      className="bg-card/60 pl-9"
                    />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
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

                <div className="mt-4 min-h-[320px]">
                  {memoriesQuery.isLoading ? (
                    <SettingsPanelSkeleton />
                  ) : filteredMemories.length > 0 ? (
                    <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                      {filteredMemories.map((memory) => (
                        <div key={memory.id} className={cn(SETTINGS_SURFACE_RADIUS, 'border border-border/70 bg-card/45 p-4')}>
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            <Badge variant={statusVariant(memory.status)}>{memory.status}</Badge>
                            <Badge variant="outline">{memory.kind ?? 'unclassified'}</Badge>
                            <Badge variant="secondary">{memory.source}</Badge>
                          </div>
                          <div className="line-clamp-3 text-sm leading-6 text-foreground">{memory.content}</div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>更新于 {formatDateTime(memory.updatedAt)}</span>
                            <Button type="button" variant="outline" size="sm" onClick={() => setSelectedMemoryId(memory.id)}>
                              查看详情
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={cn(SETTINGS_SURFACE_RADIUS, 'border border-border/70 bg-card/45 p-4 text-sm text-muted-foreground')}>
                      当前筛选下没有记忆。
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className={cn(SETTINGS_SURFACE_RADIUS, 'flex min-h-[260px] items-center justify-center border border-dashed border-border/70 bg-background/20 text-sm text-muted-foreground')}>
                需要先初始化当前 Timeline。
              </div>
            )}
          </SettingsCard>
        </div>
      );
    }

    if (activeSection === 'audit') {
      return (
        <div className="grid gap-4 xl:grid-cols-3">
          <SettingsCard
            title="自动巩固审计"
            description="查看 summary memory、ActivityLog 来源和 supersedes 链路。"
            className="xl:col-span-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm leading-6 text-muted-foreground">
                这里保留面向治理的汇总视图，具体明细继续在 Memory 弹窗里查看。
              </div>
              <Button type="button" disabled={!selectedStoryline || consolidateMutation.isPending} onClick={() => consolidateMutation.mutate()}>
                <Activity className="mr-2 h-4 w-4" />
                手动巩固
              </Button>
            </div>
          </SettingsCard>

          <SettingsCard title="Summary Memory">
            <div className="space-y-2">
              {summaryMemories.length > 0 ? summaryMemories.map((memory) => (
                <div key={memory.id} className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-card/45 p-3')}>
                  <div className="text-sm leading-6">{memory.content}</div>
                  <div className="mt-2 text-xs text-muted-foreground">来源 ActivityLog：{memory.sourceActivityIds?.length ?? 0}</div>
                </div>
              )) : <div className="text-sm text-muted-foreground">暂无 summary memory。</div>}
            </div>
          </SettingsCard>

          <SettingsCard title="重复合并链路">
            <div className="space-y-2">
              {duplicateKeepers.length > 0 ? duplicateKeepers.map((memory) => (
                <div key={memory.id} className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-card/45 p-3')}>
                  <div className="text-sm leading-6">{memory.content}</div>
                  <div className="mt-2 text-xs text-muted-foreground">supersedes：{memory.supersedes?.length ?? 0}</div>
                </div>
              )) : <div className="text-sm text-muted-foreground">暂无合并 keeper。</div>}
            </div>
          </SettingsCard>

          <SettingsCard title="Hidden / Replacement">
            <div className="space-y-2">
              {[...hiddenDuplicates, ...replacementMemories].length > 0 ? [...hiddenDuplicates, ...replacementMemories].map((memory) => (
                <div key={memory.id} className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-card/45 p-3')}>
                  <div className="flex gap-2">
                    <Badge variant={statusVariant(memory.status)}>{memory.status}</Badge>
                    <Badge variant="outline">{memory.source}</Badge>
                  </div>
                  <div className="mt-2 text-sm leading-6">{memory.content}</div>
                  <div className="mt-2 text-xs text-muted-foreground">supersededBy：{memory.supersededBy ?? '无'}</div>
                </div>
              )) : <div className="text-sm text-muted-foreground">暂无 replacement 或 hidden duplicate。</div>}
            </div>
          </SettingsCard>
        </div>
      );
    }

    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {healthQuery.isLoading ? (
          <>
            <div className="lg:col-span-2"><LoadingLabel /></div>
            <StatusCardSkeleton />
          </>
        ) : (
          (healthQuery.data?.items ?? []).map((item) => <StatusCard key={item.key} item={item} />)
        )}

        <SettingsCard title="当前探测到的连接信息" className="text-sm leading-6 text-muted-foreground lg:col-span-2">
          <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Diagnostics Snapshot
          </div>
          <div>Hermes 根目录：{healthQuery.data?.detected.hermesRoot ?? '未探测到'}</div>
          <div>API Server：{healthQuery.data?.detected.apiBaseUrl ?? '未探测到'}</div>
        </SettingsCard>
      </div>
    );
  })();

  return (
    <div className="companion-page companion-page--interior flex h-full min-h-0 flex-col overflow-hidden">
      <div className="companion-aura companion-aura--main" aria-hidden="true" />
      <div className="companion-aura companion-aura--lower" aria-hidden="true" />
      <SidebarProvider
        className="relative z-10 flex min-h-0 flex-1 flex-col"
        open={shouldCollapseSidebar ? false : sidebarOpen}
        onOpenChange={(open) => {
          if (!shouldCollapseSidebar) {
            setSidebarOpen(open);
          }
        }}
        style={{
          '--sidebar-width': '18.5rem',
          '--sidebar-width-mobile': '19rem',
          '--settings-frame-gap-y': '0.875rem',
          '--sidebar-top': 'calc(3.5rem + var(--settings-frame-gap-y))',
          '--sidebar-bottom': 'var(--settings-frame-gap-y)',
          '--settings-surface-radius': '1.75rem',
          '--settings-inner-radius': '1.25rem',
        } as React.CSSProperties}
      >
        <PageTitlebar
          className="relative z-20 companion-chat-panel border-b-0"
          title={
            <div className="flex min-w-0 items-center gap-2">
              <Button type="button" variant="ghost" size="icon" onClick={() => navigate('/')} className="size-8 rounded-full">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <SidebarTrigger />
              <h2 className="truncate text-base font-semibold tracking-tight">设置中心</h2>
            </div>
          }
        />

        <div className="min-h-0 flex-1 px-4 lg:px-6">
          <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl gap-4 py-[var(--settings-frame-gap-y)] xl:gap-6">
            <Sidebar variant="floating" collapsible="icon" className="self-stretch">
              <SettingsSidebarNav
                activeSection={activeSection}
                onSectionChange={setActiveSection}
                selectedStorylineTitle={selectedStoryline?.title}
              />
            </Sidebar>

            <SidebarInset className="min-h-0 overflow-hidden">
              {operationError ? (
                <div className={cn(SETTINGS_INNER_RADIUS, 'mb-4 border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive')}>
                  {operationError instanceof Error ? operationError.message : '设置操作失败。'}
                </div>
              ) : null}

              <div className="relative flex min-h-0 flex-1 flex-col">
                <div
                  className={cn(
                    'pointer-events-none absolute inset-x-0 top-0 z-20 transition-all duration-200',
                    showFloatingSectionHeader ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0',
                  )}
                >
                  <div className="companion-chat-panel flex w-full items-center justify-between gap-3 rounded-[var(--settings-inner-radius)] border border-border/70 bg-background/85 px-4 py-3 text-sm backdrop-blur-2xl">
                    <div className="flex min-w-0 items-center gap-2">
                      <ActiveSectionIcon className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate font-medium">{activeSectionMeta.label}</span>
                    </div>
                    <span className="truncate text-xs text-muted-foreground">{activeSectionMeta.description}</span>
                  </div>
                </div>

                <div ref={sectionScrollRef} onScroll={handleSectionScroll} className="min-h-0 flex-1 overflow-auto pr-1">
                  <div ref={sectionHeroRef} className={cn('companion-glass mb-4 p-4 md:p-5', SETTINGS_SURFACE_RADIUS)}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Workspace Settings</div>
                        <div className="mt-2 text-2xl font-semibold tracking-tight">{activeSectionMeta.label}</div>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{activeSectionMeta.description}</p>
                      </div>
                      <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-background/35 p-3 text-primary')}>
                        <ActiveSectionIcon className="h-5 w-5" />
                      </div>
                    </div>
                  </div>

                  {sectionContent}
                </div>
              </div>
            </SidebarInset>
          </div>
        </div>
      </SidebarProvider>

      <Dialog open={Boolean(selectedMemory)} onOpenChange={(open) => {
        if (!open) {
          setSelectedMemoryId(undefined);
        }
      }}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden bg-card/95 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>Memory 详情</DialogTitle>
            <DialogDescription>二级详情统一通过弹窗展开，便于在设置页里保持稳定的主布局。</DialogDescription>
          </DialogHeader>
          <div className="overflow-auto pr-1">
            {selectedMemory ? (
              <MemoryDetail
                memory={selectedMemory}
                activityLogs={activityLogs}
                allMemories={memories}
                onCorrect={openCorrection}
                onHide={(memory) => hideMemoryMutation.mutate(memory.id)}
                onRestore={(memory) => restoreMemoryMutation.mutate(memory.id)}
                actionPending={actionPending}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

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
