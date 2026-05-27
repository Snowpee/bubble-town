import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Database,
  EyeOff,
  History,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
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
  type PendingSemanticFrame,
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
  batchUpdateMemories,
  cancelPendingSemanticFrame,
  consolidateStorylineMemory,
  confirmPendingSemanticFrame,
  correctMemory,
  createCharacter,
  createSuppressedMemory,
  createStoryline,
  deleteMemory,
  deleteSuppressedMemory,
  fetchActiveStoryline,
  fetchActivityLogs,
  fetchPendingSemanticFrames,
  fetchRuntimeDiagnostics,
  fetchSuppressedMemories,
  fetchStorylineMemories,
  fetchStorylines,
  hideActivityLog,
  hideMemory,
  permanentlyDeleteMemory,
  restoreMemory,
} from '@/lib/api/story';
import { logProfileDebug } from '@/lib/debug/profile-debug';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { companionThemeOptions, type CompanionThemeName } from '@/lib/companion-theme';
import { StatusCard } from '@/components/hermes/status-card';
import { SETTINGS_ALL_FILTER_VALUE, filterSettingsMemories, getMemoryAuditRole, getMemoryRiskTags, type SettingsMemoryRisk } from './settings-memory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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

function runtimeStatusLabel(status?: 'processing' | 'updated' | 'failed' | 'skipped' | 'uncertain') {
  switch (status) {
    case 'processing':
      return '处理中';
    case 'updated':
      return '已更新';
    case 'failed':
      return '失败';
    case 'uncertain':
      return '待确认';
    case 'skipped':
    default:
      return '未触发';
  }
}

function runtimeStatusVariant(status?: 'processing' | 'updated' | 'failed' | 'skipped' | 'uncertain'): 'default' | 'secondary' | 'outline' {
  switch (status) {
    case 'updated':
      return 'default';
    case 'processing':
    case 'uncertain':
      return 'secondary';
    case 'failed':
    case 'skipped':
    default:
      return 'outline';
  }
}

function runtimeStatusClassName(status?: 'processing' | 'updated' | 'failed' | 'skipped' | 'uncertain') {
  return status === 'failed' ? 'border-destructive/40 text-destructive' : undefined;
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

const MEMORY_RISK_LABELS: Record<SettingsMemoryRisk, string> = {
  old_schema: '旧 schema',
  no_source: '无来源',
  low_confidence: '低置信',
  time_mismatch: '时间错位',
  transient_world_state: '结构化临时状态',
};

const ACTIVITY_LOG_FILTERS = ['all', 'active', 'hidden', 'consolidated', 'referenced', 'unreferenced'] as const;
type ActivityLogFilter = typeof ACTIVITY_LOG_FILTERS[number];

const ACTIVITY_LOG_FILTER_LABELS: Record<ActivityLogFilter, string> = {
  all: '全部事件',
  active: 'active',
  hidden: 'hidden',
  consolidated: '已巩固',
  referenced: '被引用',
  unreferenced: '未引用',
};

function activityReferencedByMemories(activityLogId: string, memories: MemoryRecord[]) {
  return memories.filter((memory) => memory.sourceActivityIds?.includes(activityLogId));
}

function isActivityLogConsolidated(activityLog: ActivityLog) {
  return activityLog.tags.includes('consolidated');
}

function formatMemoryPreview(memory?: MemoryRecord) {
  return memory?.content ?? '未找到关联记忆';
}

function MemoryRiskBadges({ memory, activityLogs }: { memory: MemoryRecord; activityLogs: ActivityLog[] }) {
  const risks = getMemoryRiskTags(memory, { activityLogs });
  if (risks.length === 0) {
    return null;
  }
  return (
    <>
      {risks.map((risk) => (
        <Badge key={risk} variant="outline" className="border-destructive/40 text-destructive">{MEMORY_RISK_LABELS[risk]}</Badge>
      ))}
    </>
  );
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

interface ActivityLogDetailProps {
  activityLog: ActivityLog;
  memories: MemoryRecord[];
  onOpenMemory: (memoryId: string) => void;
  onHide: (activityLog: ActivityLog) => void;
  actionPending: boolean;
}

function ActivityLogDetail({ activityLog, memories, onOpenMemory, onHide, actionPending }: ActivityLogDetailProps) {
  const referencedBy = activityReferencedByMemories(activityLog.id, memories);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusVariant(activityLog.status)}>{activityLog.status}</Badge>
            {isActivityLogConsolidated(activityLog) ? <Badge variant="secondary">已巩固</Badge> : <Badge variant="outline">未巩固</Badge>}
            {referencedBy.length > 0 ? <Badge variant="secondary">被 {referencedBy.length} 条记忆引用</Badge> : <Badge variant="outline">未被记忆引用</Badge>}
          </div>
          <p className="max-w-3xl text-sm leading-7 text-foreground">{activityLog.summary}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onHide(activityLog)}
          disabled={activityLog.status !== 'active' || actionPending}
        >
          <EyeOff className="mr-2 h-4 w-4" />
          隐藏事件
        </Button>
      </div>

      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        {[
          ['事件时间', formatDateTime(activityLog.happenedAt)],
          ['时区', activityLog.timezone],
          ['状态', activityLog.status],
          ['Embedding', activityLog.embeddingRef ?? '无'],
        ].map(([label, value]) => (
          <div key={label} className={cn(SETTINGS_INNER_RADIUS, 'border border-border/60 bg-background/35 px-3 py-2')}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 truncate font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-background/35 p-3')}>
        <div className="mb-2 text-xs font-medium text-muted-foreground">标签</div>
        <div className="flex flex-wrap gap-1.5">
          {activityLog.tags.length > 0 ? activityLog.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>) : <span className="text-xs text-muted-foreground">无标签</span>}
        </div>
      </div>

      <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-background/35 p-3')}>
        <div className="mb-2 text-xs font-medium text-muted-foreground">引用这条事件的记忆</div>
        <div className="space-y-2">
          {referencedBy.length > 0 ? referencedBy.map((memory) => (
            <button
              key={memory.id}
              type="button"
              className={cn(SETTINGS_INNER_RADIUS, 'block w-full border border-border/70 bg-card/55 px-3 py-2 text-left text-xs leading-5 transition hover:border-primary/60 hover:bg-primary/5')}
              onClick={() => onOpenMemory(memory.id)}
            >
              <div className="flex flex-wrap gap-1.5">
                <Badge variant={statusVariant(memory.status)}>{memory.status}</Badge>
                <Badge variant="outline">{memory.kind ?? 'unclassified'}</Badge>
                <Badge variant="secondary">{memory.source}</Badge>
              </div>
              <div className="mt-2 line-clamp-2 text-foreground">{memory.content}</div>
            </button>
          )) : <div className="text-xs text-muted-foreground">暂无记忆引用这条 ActivityLog。</div>}
        </div>
      </div>
    </div>
  );
}

function SettingsCard({
  id,
  title,
  description,
  className,
  children,
}: React.PropsWithChildren<{ id?: string; title: string; description?: string; className?: string }>) {
  return (
    <section id={id} className={cn('companion-glass scroll-mt-4 p-4 md:p-5', SETTINGS_SURFACE_RADIUS, className)}>
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
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === 'collapsed' && !isMobile;

  const handleSectionSelect = (section: SettingsSectionId) => {
    onSectionChange(section);
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <aside
      data-state={state}
      className={cn(
        'companion-glass relative z-30 hidden h-full shrink-0 flex-col rounded-[var(--settings-surface-radius)] text-foreground shadow-[0_24px_64px_-36px_var(--companion-glass-shadow)] transition-[width] duration-200 ease-linear md:flex',
        collapsed ? 'w-[calc(16*(var(--spacing))+2px)]' : 'w-[var(--sidebar-width)]',
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-2">

        <nav className="flex flex-col gap-2">
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon;
            const active = activeSection === section.id;
            const button = (
              <button
                key={section.id}
                type="button"
                aria-label={section.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-12 w-full items-center overflow-hidden rounded-[var(--settings-inner-radius)] px-0 text-left text-sm font-medium transition-[background-color,color] duration-200 ease-linear focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-sidebar-accent text-primary'
                    : 'text-foreground hover:bg-background/45 hover:text-primary',
                )}
                onClick={() => handleSectionSelect(section.id)}
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center">
                  <Icon className="h-5 w-5" />
                </span>
                <span
                  className={cn(
                    'ml-1 w-40 shrink-0 overflow-hidden whitespace-nowrap transition-opacity duration-200 ease-linear',
                    collapsed ? 'opacity-0' : 'opacity-100',
                  )}
                >
                  {section.label}
                </span>
              </button>
            );

            return collapsed ? (
              <Tooltip key={section.id}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right" align="center" className="z-50">
                  {section.label}
                </TooltipContent>
              </Tooltip>
            ) : button;
          })}
        </nav>
      </div>

      <div
        className={cn(
          'p-3 transition-[opacity] duration-200 ease-linear',
          collapsed && 'pointer-events-none opacity-0',
        )}
      >
        <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-background/35 px-3 py-3 text-xs leading-5 text-muted-foreground')}>
          <div className="font-medium text-foreground">当前 Timeline</div>
          <div className="mt-1">{selectedStorylineTitle ?? '尚未初始化'}</div>
        </div>
      </div>
    </aside>
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
  const [memoryStatusFilter, setMemoryStatusFilter] = useState<string>('active');
  const [memoryKindFilter, setMemoryKindFilter] = useState<string>(ALL_VALUE);
  const [memorySourceFilter, setMemorySourceFilter] = useState<string>(ALL_VALUE);
  const [memoryLinkFilter, setMemoryLinkFilter] = useState<string>(ALL_VALUE);
  const [memoryRiskFilter, setMemoryRiskFilter] = useState<string>(ALL_VALUE);
  const [memorySearch, setMemorySearch] = useState('');
  const [memoryBatchMode, setMemoryBatchMode] = useState(false);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<string[]>([]);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | undefined>(undefined);
  const [selectedActivityLogId, setSelectedActivityLogId] = useState<string | undefined>(undefined);
  const [correctionTarget, setCorrectionTarget] = useState<MemoryRecord | null>(null);
  const [correctionContent, setCorrectionContent] = useState('');
  const [activityLogFilter, setActivityLogFilter] = useState<ActivityLogFilter>('all');
  const [suppressionPattern, setSuppressionPattern] = useState('');
  const [suppressionReason, setSuppressionReason] = useState('');
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [auxiliaryDraft, setAuxiliaryDraft] = useState<UpdateAuxiliaryLlmSettingsRequest>(() => createAuxiliaryLlmDraft(DEFAULT_PROFILE_ID));
  const [auxiliaryApiKeyInput, setAuxiliaryApiKeyInput] = useState('');
  const [auxiliaryTestResult, setAuxiliaryTestResult] = useState<TestAuxiliaryLlmConnectionResponse | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [shouldCollapseSidebar, setShouldCollapseSidebar] = useState(false);
  const [showFloatingSectionHeader, setShowFloatingSectionHeader] = useState(false);
  const [showContentTopFade, setShowContentTopFade] = useState(false);
  const sectionScrollRef = useRef<HTMLDivElement | null>(null);
  const sectionHeroRef = useRef<HTMLDivElement | null>(null);

  const healthQuery = useQuery({ queryKey: ['health'], queryFn: fetchHealth });
  const profilesQuery = useQuery({ queryKey: ['profiles-settings'], queryFn: fetchProfiles });
  const storylinesQuery = useQuery({ queryKey: ['storylines'], queryFn: fetchStorylines });
  const activeStorylineQuery = useQuery({ queryKey: ['active-storyline'], queryFn: fetchActiveStoryline });
  const activeStoryline = activeStorylineQuery.data?.activeStoryline;
  const runtimeDiagnosticsQuery = useQuery({
    queryKey: ['runtime-diagnostics', activeStoryline?.id],
    queryFn: () => fetchRuntimeDiagnostics(activeStoryline!.id),
    enabled: Boolean(activeStoryline?.id),
    refetchInterval: (query) => query.state.data?.status === 'processing' ? 1000 : false,
  });
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
  const suppressedMemoriesQuery = useQuery({
    queryKey: ['storyline-suppressed-memories', selectedStoryline?.id],
    queryFn: () => fetchSuppressedMemories(selectedStoryline!.id),
    enabled: Boolean(selectedStoryline?.id),
  });
  const pendingSemanticFramesQuery = useQuery({
    queryKey: ['storyline-pending-semantic-frames', selectedStoryline?.id],
    queryFn: () => fetchPendingSemanticFrames(selectedStoryline!.id),
    enabled: Boolean(selectedStoryline?.id),
  });
  const auxiliaryLlmSettingsQuery = useQuery({
    queryKey: ['auxiliary-llm-settings', effectiveSelectedProfileId],
    queryFn: () => fetchAuxiliaryLlmSettings(effectiveSelectedProfileId || DEFAULT_PROFILE_ID),
  });

  const memories = selectedStoryline ? (memoriesQuery.data?.memories ?? []) : [];
  const activityLogs = selectedStoryline ? (activityLogsQuery.data?.activityLogs ?? []) : [];
  const suppressedMemories = selectedStoryline ? (suppressedMemoriesQuery.data?.suppressedMemories ?? []) : [];
  const pendingSemanticFrames = selectedStoryline ? (pendingSemanticFramesQuery.data?.pendingSemanticFrames ?? []) : [];
  const memoryKinds = Array.from(new Set(memories.map((memory) => memory.kind ?? 'unclassified'))).sort();
  const memorySources = Array.from(new Set(memories.map((memory) => memory.source))).sort();
  const summaryMemories = memories.filter((memory) => memory.source === 'summary');
  const duplicateKeepers = memories.filter((memory) => getMemoryAuditRole(memory, memories) === 'duplicate_keeper');
  const manualReplacementMemories = memories.filter((memory) => getMemoryAuditRole(memory, memories) === 'manual_replacement');
  const hiddenDuplicates = memories.filter((memory) => getMemoryAuditRole(memory, memories) === 'hidden_duplicate');
  const supersededByManualMemories = memories.filter((memory) => getMemoryAuditRole(memory, memories) === 'superseded_by_manual_replacement');
  const replacementMemories = [...manualReplacementMemories, ...supersededByManualMemories];
  const riskMemoryCount = memories.filter((memory) => getMemoryRiskTags(memory, { activityLogs }).length > 0).length;
  const activeActivityLogs = activityLogs.filter((activityLog) => activityLog.status === 'active');
  const hiddenActivityLogs = activityLogs.filter((activityLog) => activityLog.status === 'hidden');
  const consolidatedActivityLogs = activityLogs.filter(isActivityLogConsolidated);
  const referencedActivityLogs = activityLogs.filter((activityLog) => activityReferencedByMemories(activityLog.id, memories).length > 0);
  const filteredActivityLogs = activityLogs.filter((activityLog) => {
    if (activityLogFilter === 'active' || activityLogFilter === 'hidden') {
      return activityLog.status === activityLogFilter;
    }
    if (activityLogFilter === 'consolidated') {
      return isActivityLogConsolidated(activityLog);
    }
    if (activityLogFilter === 'referenced') {
      return activityReferencedByMemories(activityLog.id, memories).length > 0;
    }
    if (activityLogFilter === 'unreferenced') {
      return activityReferencedByMemories(activityLog.id, memories).length === 0;
    }
    return true;
  });

  const filteredMemories = useMemo(() => {
    return filterSettingsMemories(memories, {
      status: memoryStatusFilter,
      kind: memoryKindFilter,
      source: memorySourceFilter,
      link: memoryLinkFilter,
      risk: memoryRiskFilter,
      search: memorySearch,
    }, { activityLogs });
  }, [activityLogs, memories, memoryKindFilter, memoryLinkFilter, memoryRiskFilter, memorySearch, memorySourceFilter, memoryStatusFilter]);

  const selectedMemory = memories.find((memory) => memory.id === selectedMemoryId) ?? null;
  const selectedActivityLog = activityLogs.find((activityLog) => activityLog.id === selectedActivityLogId) ?? null;
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

    const mediaQuery = window.matchMedia('(max-width: 1023px)');
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
    setSelectedMemoryIds([]);
    setMemoryBatchMode(false);
  }, [effectiveSelectedProfileId, selectedStoryline?.id]);

  useEffect(() => {
    setShowFloatingSectionHeader(false);
    setShowContentTopFade(false);
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
      queryClient.invalidateQueries({ queryKey: ['storyline-suppressed-memories'] }),
      queryClient.invalidateQueries({ queryKey: ['storyline-pending-semantic-frames'] }),
      queryClient.invalidateQueries({ queryKey: ['context-preview'] }),
      queryClient.invalidateQueries({ queryKey: ['runtime-diagnostics'] }),
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
      setSelectedProfileId(nextProfileId);
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

  const deleteMemoryMutation = useMutation({
    mutationFn: (memoryId: string) => deleteMemory(memoryId),
    onSuccess: () => invalidateStorylineState(),
  });

  const restoreMemoryMutation = useMutation({
    mutationFn: (memoryId: string) => restoreMemory(memoryId),
    onSuccess: () => invalidateStorylineState(),
  });

  const permanentlyDeleteMemoryMutation = useMutation({
    mutationFn: (memoryId: string) => permanentlyDeleteMemory(memoryId),
    onSuccess: async (_, memoryId) => {
      setSelectedMemoryIds((current) => current.filter((id) => id !== memoryId));
      if (selectedMemoryId === memoryId) {
        setSelectedMemoryId(undefined);
      }
      await invalidateStorylineState();
    },
  });

  const batchMemoryMutation = useMutation({
    mutationFn: (action: 'hide' | 'restore' | 'delete') => batchUpdateMemories(selectedStoryline!.id, {
      memoryIds: selectedMemoryIds,
      action,
    }),
    onSuccess: async () => {
      setSelectedMemoryIds([]);
      setMemoryBatchMode(false);
      await invalidateStorylineState();
    },
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

  const createSuppressionMutation = useMutation({
    mutationFn: () => createSuppressedMemory(selectedStoryline!.id, {
      pattern: suppressionPattern.trim(),
      reason: suppressionReason.trim() || undefined,
    }),
    onSuccess: async () => {
      setSuppressionPattern('');
      setSuppressionReason('');
      await invalidateStorylineState();
    },
  });

  const deleteSuppressionMutation = useMutation({
    mutationFn: (suppressionId: string) => deleteSuppressedMemory(suppressionId),
    onSuccess: () => invalidateStorylineState(),
  });

  const hideActivityLogMutation = useMutation({
    mutationFn: (activityId: string) => hideActivityLog(activityId),
    onSuccess: () => invalidateStorylineState(),
  });

  const confirmPendingFrameMutation = useMutation({
    mutationFn: (frame: PendingSemanticFrame) => confirmPendingSemanticFrame(frame.storylineId, frame.id),
    onSuccess: () => invalidateStorylineState(),
  });

  const cancelPendingFrameMutation = useMutation({
    mutationFn: (frame: PendingSemanticFrame) => cancelPendingSemanticFrame(frame.storylineId, frame.id),
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

  const actionPending = hideMemoryMutation.isPending
    || deleteMemoryMutation.isPending
    || restoreMemoryMutation.isPending
    || permanentlyDeleteMemoryMutation.isPending
    || batchMemoryMutation.isPending
    || correctMemoryMutation.isPending;
  const operationError =
    switchProfileMutation.error
    ?? initializeStorylineMutation.error
    ?? hideMemoryMutation.error
    ?? deleteMemoryMutation.error
    ?? restoreMemoryMutation.error
    ?? permanentlyDeleteMemoryMutation.error
    ?? batchMemoryMutation.error
    ?? correctMemoryMutation.error
    ?? consolidateMutation.error
    ?? createSuppressionMutation.error
    ?? deleteSuppressionMutation.error
    ?? hideActivityLogMutation.error
    ?? confirmPendingFrameMutation.error
    ?? cancelPendingFrameMutation.error
    ?? resetProfileMutation.error
    ?? auxiliarySettingsMutation.error
    ?? clearAuxiliaryApiKeyMutation.error
    ?? auxiliaryTestMutation.error;

  function toggleSelectedMemory(memoryId: string, selected: boolean) {
    setSelectedMemoryIds((current) => {
      if (selected) {
        return current.includes(memoryId) ? current : [...current, memoryId];
      }
      return current.filter((id) => id !== memoryId);
    });
  }

  function toggleMemorySelection(memoryId: string) {
    setSelectedMemoryIds((current) => (
      current.includes(memoryId)
        ? current.filter((id) => id !== memoryId)
        : [...current, memoryId]
    ));
  }

  function setVisibleMemoriesSelected(selected: boolean) {
    setSelectedMemoryIds((current) => {
      const visibleIds = filteredMemories.map((memory) => memory.id);
      if (selected) {
        return Array.from(new Set([...current, ...visibleIds]));
      }
      const visibleIdSet = new Set(visibleIds);
      return current.filter((id) => !visibleIdSet.has(id));
    });
  }

  function exitMemoryBatchMode() {
    setMemoryBatchMode(false);
    setSelectedMemoryIds([]);
  }

  function openCorrection(memory: MemoryRecord) {
    setCorrectionTarget(memory);
    setCorrectionContent(memory.content);
  }

  function scrollToAuditSection(id: string) {
    if (typeof document === 'undefined') {
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleSectionScroll() {
    const scrollNode = sectionScrollRef.current;
    const heroNode = sectionHeroRef.current;
    if (!scrollNode || !heroNode) {
      return;
    }

    const nextFadeVisible = scrollNode.scrollTop > 4;
    setShowContentTopFade((current) => (current === nextFadeVisible ? current : nextFadeVisible));

    const scrollRect = scrollNode.getBoundingClientRect();
    const heroRect = heroNode.getBoundingClientRect();
    const nextVisible = heroRect.bottom <= scrollRect.top;
    setShowFloatingSectionHeader((current) => (current === nextVisible ? current : nextVisible));
  }

  const ActiveSectionIcon = activeSectionMeta.icon;
  const isSelectedProfileActive = effectiveSelectedProfileId === currentProfileId;
  const selectedTimelineIsCurrent = Boolean(
    existingSelectedStoryline?.id && activeStoryline?.id === existingSelectedStoryline.id,
  );
  const profileSwitchDisabled = !effectiveSelectedProfileId || isSelectedProfileActive || switchProfileMutation.isPending;
  const timelineActionDisabled = !effectiveSelectedProfileId
    || selectedTimelineIsCurrent
    || initializeStorylineMutation.isPending;
  const timelineActionLabel = existingSelectedStoryline
    ? '设为当前 Timeline'
    : '初始化 Timeline';
  const profileSwitchButtonLabel = switchProfileMutation.isPending
    ? '正在切换 Profile...'
    : isSelectedProfileActive ? '当前 Profile' : '切换到此 Profile';

  const sectionContent = (() => {
    if (activeSection === 'general') {
      return (
        <div className="space-y-4">
          <SettingsCard
            title="当前 Timeline"
            description="下拉选择要维护的 Profile；切换 Profile 会改变运行中的 Hermes Profile；Timeline 按钮只作用于当前运行 Profile。"
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

              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/60 bg-background/35 px-3 py-2')}>
                  <div>正在管理</div>
                  <div className="mt-1 truncate font-medium text-foreground">{selectedProfile?.name ?? effectiveSelectedProfileId}</div>
                </div>
                <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/60 bg-background/35 px-3 py-2')}>
                  <div>运行 Profile</div>
                  <div className="mt-1 truncate font-medium text-foreground">{currentProfileId}</div>
                </div>
                <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/60 bg-background/35 px-3 py-2')}>
                  <div>Timeline 状态</div>
                  <div className="mt-1 truncate font-medium text-foreground">
                    {existingSelectedStoryline ? selectedTimelineIsCurrent ? '当前已激活' : '已初始化' : '未初始化'}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={profileSwitchDisabled}
                  onClick={() => switchProfileMutation.mutate(effectiveSelectedProfileId)}
                >
                  {switchProfileMutation.isPending ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : isSelectedProfileActive ? (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {profileSwitchButtonLabel}
                </Button>
                {isSelectedProfileActive && !selectedTimelineIsCurrent ? (
                  <Button
                    type="button"
                    disabled={timelineActionDisabled}
                    onClick={() => initializeStorylineMutation.mutate()}
                  >
                    {timelineActionLabel}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  className='ml-auto'
                  disabled={!effectiveSelectedProfileId || resetProfileMutation.isPending}
                  onClick={() => {
                    setResetConfirmation('');
                    setResetDialogOpen(true);
                  }}
                >
                  重置此 Profile
                </Button>
              </div>
              {switchProfileMutation.isPending ? (
                <div className={cn(SETTINGS_INNER_RADIUS, 'flex items-center gap-2 border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground')}>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span>正在切换 Hermes Profile，并同步当前 Timeline 与会话列表。</span>
                </div>
              ) : null}

              <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-background/35 p-3 text-sm leading-6')}>
                <div className="font-medium text-foreground">{selectedStoryline?.title ?? '暂无当前 Timeline'}</div>
                <div className="mt-1 text-muted-foreground">
                  Profile：{selectedStoryline?.hermesProfileId ?? effectiveSelectedProfileId}
                </div>
                {!isSelectedProfileActive ? (
                  <div className="mt-1 text-muted-foreground">此 Profile 只是管理目标；切换后才会接管主聊天和 Timeline。</div>
                ) : null}
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
                  <div className="text-xs text-muted-foreground">
                    {filteredMemories.length} / {memories.length}
                    {memoryBatchMode ? `，已选 ${selectedMemoryIds.length}` : ''}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {memoryBatchMode ? (
                      <>
                        <Button type="button" variant="outline" size="sm" onClick={() => setVisibleMemoriesSelected(true)} disabled={filteredMemories.length === 0}>
                          选择当前筛选
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setSelectedMemoryIds([])} disabled={selectedMemoryIds.length === 0}>
                          清空选择
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => batchMemoryMutation.mutate('hide')} disabled={!selectedStoryline || selectedMemoryIds.length === 0 || batchMemoryMutation.isPending}>
                          批量隐藏
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => batchMemoryMutation.mutate('restore')} disabled={!selectedStoryline || selectedMemoryIds.length === 0 || batchMemoryMutation.isPending}>
                          批量恢复
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => batchMemoryMutation.mutate('delete')} disabled={!selectedStoryline || selectedMemoryIds.length === 0 || batchMemoryMutation.isPending}>
                          批量删除
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={exitMemoryBatchMode}>
                          完成
                        </Button>
                      </>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={() => setMemoryBatchMode(true)} disabled={filteredMemories.length === 0}>
                        批量管理
                      </Button>
                    )}
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
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
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
                    <Select value={memoryRiskFilter} onValueChange={setMemoryRiskFilter}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VALUE}>全部风险</SelectItem>
                        {Object.entries(MEMORY_RISK_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="mt-4 min-h-[320px]">
                  {memoriesQuery.isLoading ? (
                    <SettingsPanelSkeleton />
                  ) : filteredMemories.length > 0 ? (
                    <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                      {filteredMemories.map((memory) => {
                        const selected = selectedMemoryIds.includes(memory.id);
                        return (
                          <div
                            key={memory.id}
                            className={cn(
                              SETTINGS_SURFACE_RADIUS,
                              'relative border bg-card/45 p-4 transition',
                              memoryBatchMode ? 'cursor-pointer hover:border-primary/60 hover:bg-primary/5' : 'border-border/70',
                              selected ? 'border-primary bg-primary/10 ring-2 ring-primary/25' : 'border-border/70',
                            )}
                            role={memoryBatchMode ? 'button' : undefined}
                            tabIndex={memoryBatchMode ? 0 : undefined}
                            aria-pressed={memoryBatchMode ? selected : undefined}
                            onClick={() => {
                              if (memoryBatchMode) {
                                toggleMemorySelection(memory.id);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (!memoryBatchMode || (event.key !== 'Enter' && event.key !== ' ')) {
                                return;
                              }
                              event.preventDefault();
                              toggleMemorySelection(memory.id);
                            }}
                          >
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap gap-1.5">
                              {memoryBatchMode ? (
                                <input
                                  type="checkbox"
                                  className="mt-0.5 h-4 w-4 accent-primary"
                                  checked={selected}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => toggleSelectedMemory(memory.id, event.target.checked)}
                                  aria-label="选择记忆"
                                />
                              ) : null}
                              <Badge variant={statusVariant(memory.status)}>{memory.status}</Badge>
                              <Badge variant="outline">{memory.kind ?? 'unclassified'}</Badge>
                              <Badge variant="secondary">{memory.source}</Badge>
                              <MemoryRiskBadges memory={memory} activityLogs={activityLogs} />
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 w-8 shrink-0 p-0"
                                  onClick={(event) => event.stopPropagation()}
                                  aria-label="记忆操作"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {memory.status === 'deleted' ? (
                                  <>
                                    <DropdownMenuItem
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        restoreMemoryMutation.mutate(memory.id);
                                      }}
                                      disabled={actionPending}
                                    >
                                      <RotateCcw className="mr-2 h-4 w-4" />
                                      恢复
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        permanentlyDeleteMemoryMutation.mutate(memory.id);
                                      }}
                                      disabled={actionPending}
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      永久删除
                                    </DropdownMenuItem>
                                  </>
                                ) : (
                                  <>
                                    <DropdownMenuItem
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        hideMemoryMutation.mutate(memory.id);
                                      }}
                                      disabled={memory.status === 'hidden' || actionPending}
                                    >
                                      <EyeOff className="mr-2 h-4 w-4" />
                                      隐藏
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        deleteMemoryMutation.mutate(memory.id);
                                      }}
                                      disabled={actionPending}
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      删除
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <div className="line-clamp-3 text-sm leading-6 text-foreground">{memory.content}</div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>事件 {formatDateTime(memory.sourceHappenedAtStart) || '无'} · 更新 {formatDateTime(memory.updatedAt)}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedMemoryId(memory.id);
                              }}
                            >
                              查看详情
                            </Button>
                          </div>
                          </div>
                        );
                      })}
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
        <div className="space-y-4">
          <SettingsCard
            title="治理概览"
            description="追溯记忆来源、替代链路和待处理语义帧。优先处理待确认、风险记忆和错误事件。"
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {[
                { label: '待确认语义帧', value: pendingSemanticFrames.length, target: 'audit-pending', tone: pendingSemanticFrames.length > 0 ? 'text-primary' : 'text-foreground' },
                { label: '风险记忆', value: riskMemoryCount, target: 'audit-summary', tone: riskMemoryCount > 0 ? 'text-destructive' : 'text-foreground' },
                { label: 'Summary', value: summaryMemories.length, target: 'audit-summary', tone: 'text-foreground' },
                { label: '替代链路', value: duplicateKeepers.length + replacementMemories.length, target: 'audit-replacements', tone: 'text-foreground' },
                { label: 'Active 事件', value: activeActivityLogs.length, target: 'audit-activity', tone: 'text-foreground' },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-card/45 p-3 text-left transition hover:border-primary/60 hover:bg-primary/5')}
                  onClick={() => scrollToAuditSection(item.target)}
                >
                  <div className={cn('text-2xl font-semibold tracking-tight', item.tone)}>{item.value}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.label}</div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm leading-6 text-muted-foreground">ActivityLog 是事件流水账，Memory 是最终沉淀的记忆；summary 和 replacement 都应该能回到来源事件或旧记忆。</div>
              <Button type="button" disabled={!selectedStoryline || consolidateMutation.isPending} onClick={() => consolidateMutation.mutate()}>
                <Activity className="mr-2 h-4 w-4" />
                手动巩固
              </Button>
            </div>
          </SettingsCard>

          <div className="grid gap-4 xl:grid-cols-3">
          <SettingsCard id="audit-summary" title="Summary / Consolidation" description="系统把多条 ActivityLog 巩固成摘要记忆；点击卡片可查看完整详情。">
            <div className="space-y-2">
              {summaryMemories.length > 0 ? summaryMemories.map((memory) => (
                <button
                  key={memory.id}
                  type="button"
                  className={cn(SETTINGS_INNER_RADIUS, 'block w-full border border-border/70 bg-card/45 p-3 text-left transition hover:border-primary/60 hover:bg-primary/5')}
                  onClick={() => setSelectedMemoryId(memory.id)}
                >
                  <div className="line-clamp-4 text-sm leading-6">{memory.content}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>来源事件：{memory.sourceActivityIds?.length ?? 0}</span>
                    <span>事件 {formatDateTime(memory.sourceHappenedAtStart)}</span>
                  </div>
                  <div className="mt-3 space-y-1">
                    {findActivitiesByIds(activityLogs, memory.sourceActivityIds).slice(0, 2).map((activityLog) => (
                      <div key={activityLog.id} className={cn(SETTINGS_INNER_RADIUS, 'bg-background/40 px-2 py-1.5 text-xs leading-5 text-muted-foreground')}>
                        <span className="line-clamp-2">{activityLog.summary}</span>
                      </div>
                    ))}
                  </div>
                </button>
              )) : <div className="text-sm text-muted-foreground">暂无 summary memory。</div>}
            </div>
          </SettingsCard>

          <SettingsCard id="audit-replacements" title="Replacement / Supersedes" description="区分重复合并 keeper 和人工纠正 replacement，避免把所有替代关系混成一类。">
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">重复合并 keeper</div>
              {duplicateKeepers.length > 0 ? duplicateKeepers.map((memory) => (
                <button key={memory.id} type="button" className={cn(SETTINGS_INNER_RADIUS, 'block w-full border border-border/70 bg-card/45 p-3 text-left transition hover:border-primary/60 hover:bg-primary/5')} onClick={() => setSelectedMemoryId(memory.id)}>
                  <div className="line-clamp-3 text-sm leading-6">{memory.content}</div>
                  <div className="mt-2 text-xs text-muted-foreground">supersedes：{memory.supersedes?.length ?? 0}</div>
                </button>
              )) : <div className="text-sm text-muted-foreground">暂无合并 keeper。</div>}

              <div className="pt-2 text-xs font-medium text-muted-foreground">人工纠正 replacement</div>
              {manualReplacementMemories.length > 0 ? manualReplacementMemories.map((memory) => (
                <button key={memory.id} type="button" className={cn(SETTINGS_INNER_RADIUS, 'block w-full border border-border/70 bg-card/45 p-3 text-left transition hover:border-primary/60 hover:bg-primary/5')} onClick={() => setSelectedMemoryId(memory.id)}>
                  <div className="flex gap-2">
                    <Badge variant={statusVariant(memory.status)}>{memory.status}</Badge>
                    <Badge variant="outline">{memory.source}</Badge>
                    <Badge variant="secondary">manual correction</Badge>
                  </div>
                  <div className="mt-2 line-clamp-3 text-sm leading-6">{memory.content}</div>
                  <div className="mt-2 text-xs text-muted-foreground">替代了：{memory.supersedes?.map((id) => formatMemoryPreview(memories.find((item) => item.id === id))).join('、') || '无'}</div>
                </button>
              )) : <div className="text-sm text-muted-foreground">暂无人工纠正 replacement。</div>}
            </div>
          </SettingsCard>

          <SettingsCard title="Hidden Memory" description="这些是被 keeper 或 replacement 替代后隐藏的旧记忆，仍保留审计链。">
            <div className="space-y-2">
              {[...hiddenDuplicates, ...supersededByManualMemories].length > 0 ? [...hiddenDuplicates, ...supersededByManualMemories].map((memory) => {
                const replacement = memories.find((item) => item.id === memory.supersededBy);
                return (
                  <button key={memory.id} type="button" className={cn(SETTINGS_INNER_RADIUS, 'block w-full border border-border/70 bg-card/45 p-3 text-left transition hover:border-primary/60 hover:bg-primary/5')} onClick={() => setSelectedMemoryId(memory.id)}>
                    <div className="flex gap-2">
                      <Badge variant={statusVariant(memory.status)}>{memory.status}</Badge>
                      <Badge variant="outline">{getMemoryAuditRole(memory, memories) === 'hidden_duplicate' ? 'duplicate hidden' : 'superseded old memory'}</Badge>
                    </div>
                    <div className="mt-2 line-clamp-3 text-sm leading-6">{memory.content}</div>
                    <div className="mt-2 text-xs text-muted-foreground">被替代为：{formatMemoryPreview(replacement)}</div>
                  </button>
                );
              }) : <div className="text-sm text-muted-foreground">暂无 hidden replacement 链路。</div>}
            </div>
          </SettingsCard>

          <SettingsCard title="Suppression Rules" description="不希望系统主动提起的主题规则。">
            <div className="space-y-3">
              <div className="grid gap-2">
                <Input value={suppressionPattern} onChange={(event) => setSuppressionPattern(event.target.value)} placeholder="pattern" className="bg-card/60" />
                <Input value={suppressionReason} onChange={(event) => setSuppressionReason(event.target.value)} placeholder="reason" className="bg-card/60" />
                <Button type="button" variant="outline" disabled={!selectedStoryline || !suppressionPattern.trim() || createSuppressionMutation.isPending} onClick={() => createSuppressionMutation.mutate()}>
                  添加规则
                </Button>
              </div>
              <div className="space-y-2">
                {suppressedMemories.length > 0 ? suppressedMemories.map((suppression) => (
                  <div key={suppression.id} className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-card/45 p-3')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{suppression.pattern}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{suppression.reason || '未记录 reason'}</div>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => deleteSuppressionMutation.mutate(suppression.id)} disabled={deleteSuppressionMutation.isPending}>
                        删除
                      </Button>
                    </div>
                  </div>
                )) : <div className="text-sm text-muted-foreground">暂无 suppression rule。</div>}
              </div>
            </div>
          </SettingsCard>

          <SettingsCard id="audit-pending" title="Pending Semantic Frames" description="系统不确定的关系或语义变化会先放在这里，确认后才正式写入 memory。">
            <div className="space-y-2">
              {pendingSemanticFrames.length > 0 ? pendingSemanticFrames.map((frame) => (
                <div key={frame.id} className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-card/45 p-3')}>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Badge variant="outline">{frame.kind}</Badge>
                    <Badge variant="outline">{frame.status}</Badge>
                  </div>
                  <div className="text-sm leading-6">{frame.candidate.content}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{frame.prompt}</div>
                  <div className="mt-3 flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => confirmPendingFrameMutation.mutate(frame)} disabled={confirmPendingFrameMutation.isPending}>
                      确认写入
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => cancelPendingFrameMutation.mutate(frame)} disabled={cancelPendingFrameMutation.isPending}>
                      取消
                    </Button>
                  </div>
                </div>
              )) : <div className="text-sm text-muted-foreground">暂无待确认语义帧。</div>}
            </div>
          </SettingsCard>

          <SettingsCard id="audit-activity" title="ActivityLog 事件流水账" description="ActivityLog 是生成记忆前的事件记录。可查看是否已巩固、是否被 memory 引用，并隐藏错误事件。" className="xl:col-span-3">
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-card/45 p-3')}><div className="text-2xl font-semibold">{activityLogs.length}</div><div className="text-xs text-muted-foreground">全部事件</div></div>
              <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-card/45 p-3')}><div className="text-2xl font-semibold">{consolidatedActivityLogs.length}</div><div className="text-xs text-muted-foreground">已巩固</div></div>
              <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-card/45 p-3')}><div className="text-2xl font-semibold">{referencedActivityLogs.length}</div><div className="text-xs text-muted-foreground">被记忆引用</div></div>
              <div className={cn(SETTINGS_INNER_RADIUS, 'border border-border/70 bg-card/45 p-3')}><div className="text-2xl font-semibold">{hiddenActivityLogs.length}</div><div className="text-xs text-muted-foreground">已隐藏</div></div>
            </div>
            <div className="mb-4">
              <Select value={activityLogFilter} onValueChange={(value) => setActivityLogFilter(value as ActivityLogFilter)}>
                <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVITY_LOG_FILTERS.map((filter) => <SelectItem key={filter} value={filter}>{ACTIVITY_LOG_FILTER_LABELS[filter]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {filteredActivityLogs.length > 0 ? filteredActivityLogs.slice(0, 30).map((activityLog) => {
                const referencedBy = activityReferencedByMemories(activityLog.id, memories);
                return (
                  <div
                    key={activityLog.id}
                    role="button"
                    tabIndex={0}
                    className={cn(SETTINGS_INNER_RADIUS, 'cursor-pointer border border-border/70 bg-card/45 p-3 text-left transition hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
                    onClick={() => setSelectedActivityLogId(activityLog.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedActivityLogId(activityLog.id);
                      }
                    }}
                  >
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      <Badge variant={statusVariant(activityLog.status)}>{activityLog.status}</Badge>
                      {isActivityLogConsolidated(activityLog) ? <Badge variant="secondary">已巩固</Badge> : <Badge variant="outline">未巩固</Badge>}
                      {referencedBy.length > 0 ? <Badge variant="secondary">引用 {referencedBy.length}</Badge> : <Badge variant="outline">未引用</Badge>}
                      {activityLog.tags.slice(0, 3).map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                    </div>
                    <div className="line-clamp-3 text-sm leading-6">{activityLog.summary}</div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{formatDateTime(activityLog.happenedAt)}</span>
                      <Button type="button" variant="outline" size="sm" onClick={(event) => {
                        event.stopPropagation();
                        hideActivityLogMutation.mutate(activityLog.id);
                      }} disabled={activityLog.status !== 'active' || hideActivityLogMutation.isPending}>
                        隐藏
                      </Button>
                    </div>
                  </div>
                );
              }) : <div className="text-sm text-muted-foreground">当前筛选下暂无 ActivityLog。</div>}
            </div>
          </SettingsCard>
          </div>
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

        <SettingsCard title="Runtime Diagnostics" className="text-sm leading-6 lg:col-span-2">
          {activeStoryline ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={runtimeStatusVariant(runtimeDiagnosticsQuery.data?.status)}
                  className={runtimeStatusClassName(runtimeDiagnosticsQuery.data?.status)}
                >
                  {runtimeStatusLabel(runtimeDiagnosticsQuery.data?.status)}
                </Badge>
                <span className="font-medium text-foreground">{activeStoryline.title}</span>
              </div>
              <div className="text-muted-foreground">
                {runtimeDiagnosticsQuery.data?.statusDetail ?? '当前 storyline 暂无最近一次后台派生记录。'}
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>可重试：{runtimeDiagnosticsQuery.data?.canRetry ? '是' : '否'}</span>
                <span>world-state：{runtimeDiagnosticsQuery.data?.worldStateDebug?.processingPath ?? '无'}</span>
                <span>memory writes：{runtimeDiagnosticsQuery.data?.productMemory?.writeResults.length ?? 0}</span>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground">当前没有 active storyline，可在聊天页触发一次派生后再查看 diagnostics。</div>
          )}
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
          '--sidebar-width': '19rem',
          '--sidebar-width-mobile': '19rem',
          '--settings-frame-gap-y': '0.875rem',
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
            <SettingsSidebarNav
              activeSection={activeSection}
              onSectionChange={setActiveSection}
              selectedStorylineTitle={selectedStoryline?.title}
            />

            <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
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

                <div
                  ref={sectionScrollRef}
                  onScroll={handleSectionScroll}
                  className={cn('min-h-0 flex-1 overflow-auto', showContentTopFade && 'settings-content-fade')}
                >
                  <div ref={sectionHeroRef} className={cn('companion-glass mb-4 p-4 md:p-5', SETTINGS_SURFACE_RADIUS)}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        {/* <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Workspace Settings</div> */}
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
            </main>
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

      <Dialog open={Boolean(selectedActivityLog)} onOpenChange={(open) => {
        if (!open) {
          setSelectedActivityLogId(undefined);
        }
      }}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden bg-card/95 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>ActivityLog 详情</DialogTitle>
            <DialogDescription>ActivityLog 是记忆生成前的事件流水账；隐藏它不会删除 Hermes 原始聊天记录。</DialogDescription>
          </DialogHeader>
          <div className="overflow-auto pr-1">
            {selectedActivityLog ? (
              <ActivityLogDetail
                activityLog={selectedActivityLog}
                memories={memories}
                onOpenMemory={(memoryId) => {
                  setSelectedActivityLogId(undefined);
                  setSelectedMemoryId(memoryId);
                }}
                onHide={(activityLog) => hideActivityLogMutation.mutate(activityLog.id)}
                actionPending={hideActivityLogMutation.isPending}
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
