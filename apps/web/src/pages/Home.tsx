import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_PROFILE_ID } from '@bubble-town/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchProfiles, switchProfile } from '@/lib/api/profiles';
import { createCharacter, createStoryline, fetchActiveStoryline } from '@/lib/api/story';
import { useWorkspaceStore } from '@/lib/state/workspace-store';

export default function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const activeStorylineQuery = useQuery({ queryKey: ['active-storyline'], queryFn: fetchActiveStoryline });
  const profilesQuery = useQuery({ queryKey: ['profiles-debug'], queryFn: fetchProfiles });
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(undefined);
  const setActiveStorylineId = useWorkspaceStore((state) => state.setActiveStorylineId);
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const setActiveProfileId = useWorkspaceStore((state) => state.setActiveProfileId);
  const activeStoryline = activeStorylineQuery.data?.activeStoryline;
  const profiles = profilesQuery.data?.profiles ?? [];
  const currentProfileId = profilesQuery.data?.activeProfileId ?? activeProfileId ?? DEFAULT_PROFILE_ID;
  const effectiveSelectedProfileId = selectedProfileId ?? currentProfileId;
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === effectiveSelectedProfileId),
    [effectiveSelectedProfileId, profiles],
  );

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
      await queryClient.invalidateQueries({ queryKey: ['profiles-debug'] });
    },
  });

  const initializeStorylineMutation = useMutation({
    mutationFn: async () => {
      const profileId = effectiveSelectedProfileId || DEFAULT_PROFILE_ID;
      const character = await createCharacter({
        name: selectedProfile?.name ? `${selectedProfile.name} 角色` : '默认角色',
        templateProfileId: profileId,
        description: '初始 MVP 调试角色',
      });
      return createStoryline({
        characterId: character.id,
        hermesProfileId: profileId,
        title: selectedProfile?.name ? `${selectedProfile.name} 当前剧情` : '当前剧情',
        description: '由初始 MVP 调试入口创建',
      });
    },
    onSuccess: async (storyline) => {
      setActiveStorylineId(storyline.id);
      await queryClient.invalidateQueries({ queryKey: ['active-storyline'] });
      navigate('/chat');
    },
  });

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <MessageCircle className="h-7 w-7" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">继续对话</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {activeStoryline ? activeStoryline.title : '当前还没有可继续的剧情。'}
          </p>
        </div>
        <Button
          type="button"
          className="h-12 rounded-xl px-6"
          onClick={() => navigate('/chat')}
          disabled={activeStorylineQuery.isLoading}
        >
          继续对话
        </Button>

        {!activeStoryline ? (
          <div className="mt-4 w-full rounded-lg border border-dashed border-border bg-secondary/20 p-4 text-left">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-foreground">调试初始化</div>
                <div className="text-xs leading-5 text-muted-foreground">切换 profile，并用它创建当前剧情。</div>
              </div>
              <Badge variant="secondary">debug</Badge>
            </div>
            <div className="space-y-3">
              <Select
                value={effectiveSelectedProfileId}
                onValueChange={(value) => setSelectedProfileId(value)}
                disabled={profilesQuery.isLoading || profiles.length === 0}
              >
                <SelectTrigger className="bg-background">
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
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 rounded-xl"
                  disabled={!effectiveSelectedProfileId || switchProfileMutation.isPending}
                  onClick={() => switchProfileMutation.mutate(effectiveSelectedProfileId)}
                >
                  切换 profile
                </Button>
                <Button
                  type="button"
                  className="flex-1 rounded-xl"
                  disabled={!effectiveSelectedProfileId || initializeStorylineMutation.isPending}
                  onClick={() => initializeStorylineMutation.mutate()}
                >
                  初始化当前剧情
                </Button>
              </div>
              {switchProfileMutation.error || initializeStorylineMutation.error ? (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                  {(switchProfileMutation.error ?? initializeStorylineMutation.error) instanceof Error
                    ? (switchProfileMutation.error ?? initializeStorylineMutation.error as Error).message
                    : '调试操作失败。'}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
