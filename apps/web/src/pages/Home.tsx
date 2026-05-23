import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, MessageCircle, Settings, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { companionThemes } from '@/lib/companion-theme';
import { fetchActiveStoryline } from '@/lib/api/story';
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
  const activeStorylineQuery = useQuery({ queryKey: ['active-storyline'], queryFn: fetchActiveStoryline });
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const setActiveStorylineId = useWorkspaceStore((state) => state.setActiveStorylineId);
  const companionThemeName = useWorkspaceStore((state) => state.companionTheme);
  const activeStoryline = activeStorylineQuery.data?.activeStoryline;
  const companionTheme = companionThemes[companionThemeName];
  const greeting = useMemo(() => getTimeOfDayGreeting(currentTime), [currentTime]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setActiveStorylineId(activeStoryline?.id);
  }, [activeStoryline?.id, setActiveStorylineId]);

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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="app-no-drag h-10 w-10 rounded-full bg-secondary/70 p-0 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl hover:bg-secondary"
          aria-label="打开设置"
          onClick={() => navigate('/settings')}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </header>

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
              <small>{activeStoryline ? '回到上次的故事现场' : '进入设置中心完成初始化'}</small>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </button>
        </section>
      </main>
    </div>
  );
}
