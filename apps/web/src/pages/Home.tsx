import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, MessageCircle, Settings, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_PROFILE_ID } from '@bubble-town/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { companionThemeOptions, companionThemes, type CompanionThemeName } from '@/lib/companion-theme';
import { fetchProfiles, prepareProfileForStoryline, switchProfile } from '@/lib/api/profiles';
import { activateStorylineForProfile, createCharacter, createStoryline, fetchActiveStoryline, fetchStorylines } from '@/lib/api/story';
import { useWorkspaceStore } from '@/lib/state/workspace-store';

const ShapeBlur = lazy(() => import('@/components/effects/ShapeBlur').then((module) => ({ default: module.ShapeBlur })));

function getTimeOfDayGreeting(date: Date) {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) {
    return 'Good Morning';
  }

  if (hour >= 12 && hour < 18) {
    return 'Good Afternoon';
  }

  if (hour >= 18 && hour < 22) {
    return 'Good Evening';
  }

  return 'Good Night';
}

export default function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const activeStorylineQuery = useQuery({ queryKey: ['active-storyline'], queryFn: fetchActiveStoryline });
  const storylinesQuery = useQuery({ queryKey: ['storylines'], queryFn: fetchStorylines });
  const profilesQuery = useQuery({ queryKey: ['profiles-debug'], queryFn: fetchProfiles });
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(undefined);
  const [initializeDialogOpen, setInitializeDialogOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const setActiveStorylineId = useWorkspaceStore((state) => state.setActiveStorylineId);
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const setActiveProfileId = useWorkspaceStore((state) => state.setActiveProfileId);
  const companionThemeName = useWorkspaceStore((state) => state.companionTheme);
  const setCompanionTheme = useWorkspaceStore((state) => state.setCompanionTheme);
  const activeStoryline = activeStorylineQuery.data?.activeStoryline;
  const companionTheme = companionThemes[companionThemeName];
  const profiles = profilesQuery.data?.profiles ?? [];
  const currentProfileId = profilesQuery.data?.activeProfileId ?? activeProfileId ?? DEFAULT_PROFILE_ID;
  const effectiveSelectedProfileId = selectedProfileId ?? currentProfileId;
  const existingSelectedStoryline = useMemo(
    () => (storylinesQuery.data?.storylines ?? []).find((storyline) => storyline.hermesProfileId === effectiveSelectedProfileId && storyline.status === 'active'),
    [effectiveSelectedProfileId, storylinesQuery.data?.storylines],
  );
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === effectiveSelectedProfileId),
    [effectiveSelectedProfileId, profiles],
  );
  const greeting = useMemo(() => getTimeOfDayGreeting(currentTime), [currentTime]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setActiveStorylineId(activeStoryline?.id);
  }, [activeStoryline?.id, setActiveStorylineId]);

  useEffect(() => {
    if (profilesQuery.data?.activeProfileId) {
      setActiveProfileId(profilesQuery.data.activeProfileId);
      setSelectedProfileId((current) => current ?? profilesQuery.data.activeProfileId);
    }
  }, [profilesQuery.data?.activeProfileId, setActiveProfileId]);

  const switchProfileMutation = useMutation({
    mutationFn: (profileId: string) => switchProfile(profileId),
    onSuccess: async (result) => {
      const nextProfileId = result.activeProfile?.id ?? DEFAULT_PROFILE_ID;
      setActiveProfileId(nextProfileId);
      setSelectedProfileId(nextProfileId);
      const storylineResult = await activateStorylineForProfile(nextProfileId);
      setActiveStorylineId(storylineResult.activeStoryline?.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profiles-debug'] }),
        queryClient.invalidateQueries({ queryKey: ['active-storyline'] }),
        queryClient.invalidateQueries({ queryKey: ['storylines'] }),
        queryClient.invalidateQueries({ queryKey: ['context-preview'] }),
      ]);
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
        description: '由初始 MVP 调试入口创建',
      });
    },
    onSuccess: async (storyline) => {
      setInitializeDialogOpen(false);
      setActiveStorylineId(storyline.id);
      await queryClient.invalidateQueries({ queryKey: ['active-storyline'] });
      await queryClient.invalidateQueries({ queryKey: ['storylines'] });
      await queryClient.invalidateQueries({ queryKey: ['profiles-debug'] });
      navigate('/chat');
    },
  });

  const debugError = switchProfileMutation.error ?? initializeStorylineMutation.error;

  return (
    <div className="companion-page companion-page--home flex min-h-0 flex-1 overflow-hidden">
      <div className="companion-aura companion-aura--main" aria-hidden="true" />
      <div className="companion-aura companion-aura--lower" aria-hidden="true" />
      <div className="companion-flow-grid" aria-hidden="true" />
      <Suspense fallback={null}>
        <ShapeBlur
          className="companion-shape-blur"
          variation={0}
          shapeSize={1.2}
          roundness={1.2}
          borderSize={0.052}
          circleSize={0.38}
          circleEdge={0.62}
          color={companionTheme.accent}
          idleBlurMin={0.0}
          idleBlurMax={0.5}
          idleSpeed={0.9}
          idleFocusRadius={0.3}
          idleFocusEdge={0.62}
          idleOrbitCenterX={0.5}
          idleOrbitCenterY={0.5}
          idleOrbitRadiusX={0.2}
          idleOrbitRadiusY={0.2}
          interactionBlurMin={0}
          interactionBlurMax={1}
          interactionResponseDistance={96}
        />
      </Suspense>

      <header className="app-drag-region companion-window-bar absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between px-5">
        <div className="companion-brand flex items-center gap-2 text-sm font-medium">
          {/* <span className="companion-brand__mark h-5 w-5 rounded-full border-[5px]" />
          <span>Bubble Town</span> */}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="app-no-drag h-10 w-10 rounded-full bg-secondary/70 p-0 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl hover:bg-secondary"
              aria-label="打开设置"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 rounded-2xl border-white/50 bg-white/70 p-4 shadow-2xl backdrop-blur-2xl">
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-foreground">设置</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  切换 profile、初始化剧情和连接配置统一放在这里。
                </div>
              </div>
              <div className="space-y-3">
                <Select value={companionThemeName} onValueChange={(value) => setCompanionTheme(value as CompanionThemeName)}>
                  <SelectTrigger className="rounded-xl border-border bg-card/70">
                    <SelectValue placeholder="选择主题" />
                  </SelectTrigger>
                  <SelectContent>
                    {companionThemeOptions.map((theme) => (
                      <SelectItem key={theme.value} value={theme.value}>
                        {theme.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={effectiveSelectedProfileId}
                  onValueChange={(value) => setSelectedProfileId(value)}
                  disabled={profilesQuery.isLoading || profiles.length === 0}
                >
                  <SelectTrigger className="rounded-xl border-border bg-card/70">
                    <SelectValue placeholder="选择 profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full rounded-xl border-border bg-card/60 text-foreground hover:bg-card"
                  disabled={!effectiveSelectedProfileId || switchProfileMutation.isPending}
                  onClick={() => switchProfileMutation.mutate(effectiveSelectedProfileId)}
                >
                  切换 profile
                </Button>
                {!activeStoryline ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full rounded-xl border-border bg-card/60 text-foreground hover:bg-card"
                    disabled={!effectiveSelectedProfileId || initializeStorylineMutation.isPending}
                    onClick={() => setInitializeDialogOpen(true)}
                  >
                    {existingSelectedStoryline ? '激活当前 Timeline' : '初始化当前 Timeline'}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full rounded-xl text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                  onClick={() => navigate('/settings')}
                >
                  打开完整设置
                </Button>
                {debugError ? (
                  <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                    {debugError instanceof Error ? debugError.message : '调试操作失败。'}
                  </div>
                ) : null}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </header>

      <Dialog open={initializeDialogOpen} onOpenChange={setInitializeDialogOpen}>
        <DialogContent className="bg-card/95 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>{existingSelectedStoryline ? '激活当前 Timeline' : '初始化当前 Timeline'}</DialogTitle>
            <DialogDescription>
              {existingSelectedStoryline
                ? `profile「${effectiveSelectedProfileId || DEFAULT_PROFILE_ID}」已经有当前 Timeline。`
                : `将把 profile「${effectiveSelectedProfileId || DEFAULT_PROFILE_ID}」准备为 Bubble Town 剧情容器。`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm leading-6 text-muted-foreground">
            {existingSelectedStoryline ? (
              <p>确认后应用只会激活已有剧情「{existingSelectedStoryline.title}」，不会再次修改 profile 配置或创建新的 Storyline。</p>
            ) : (
              <>
                <p>确认后应用会修改该 profile 的基础设置：</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>将 `config.yaml` 中的 `session_reset.mode` 补齐为 `none`。</li>
                  <li>如果 `SOUL.md` 为空，会写入一个基础拟人化助手人设。</li>
                  <li>如果 `SOUL.md` 已有内容，会追加 Bubble Town ContextPack 和 authoritative time 优先规则。</li>
                  <li>确保该 profile 有 sessions 目录，然后创建当前 Storyline。</li>
                </ul>
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInitializeDialogOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!effectiveSelectedProfileId || initializeStorylineMutation.isPending}
              onClick={() => initializeStorylineMutation.mutate()}
            >
              {existingSelectedStoryline ? '确认激活' : '确认初始化'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col justify-between px-6 pb-8 pt-24 sm:px-10 lg:px-20 lg:pb-14 lg:pt-28">
        <section className="max-w-[34rem]">
          <p className="mb-5 text-xs font-medium uppercase tracking-[0.34em] text-primary">linearly yours</p>
          <h1 className="font-serif text-[3.6rem] font-medium leading-[1.04] tracking-normal text-foreground sm:text-[5.2rem]">
            {greeting}
          </h1>
          <p className="mt-7 max-w-md text-base leading-8 text-muted-foreground sm:text-lg">
            {activeStoryline ? activeStoryline.title : '当前还没有可继续的剧情。'}
          </p>
        </section>

        <section className="w-full max-w-3xl">
          <button
            type="button"
            onClick={() => navigate('/chat')}
            disabled={activeStorylineQuery.isLoading || !activeStoryline}
            className="companion-primary-action group w-full disabled:cursor-not-allowed disabled:opacity-55"
          >
            <span className="companion-primary-action__icon">
              {activeStoryline ? <MessageCircle className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
            </span>
            <span className="min-w-0 flex-1 text-left">
              <strong>{activeStoryline ? '继续聊天' : '先在设置中初始化剧情'}</strong>
              <small>{activeStoryline ? '回到上次的故事现场' : '打开右上角设置按钮完成初始化'}</small>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </button>
        </section>
      </main>
    </div>
  );
}
