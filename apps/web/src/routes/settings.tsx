import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_PROFILE_ID, type ProfilesResponse } from '@bubble-town/shared';
import { fetchHealth } from '@/lib/api/hermes';
import { PageTitlebar } from '@/components/layout/page-titlebar';
import { LoadingLabel, SettingsPanelSkeleton, StatusCardSkeleton } from '@/components/loading/loading-state';
import { markActiveProfileInResponse } from '@/lib/api/profile-cache';
import { fetchProfiles, switchProfile } from '@/lib/api/profiles';
import { logProfileDebug } from '@/lib/debug/profile-debug';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { companionThemeOptions, type CompanionThemeName } from '@/lib/companion-theme';
import { StatusCard } from '@/components/hermes/status-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function SettingsRoute() {
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const chatMode = useWorkspaceStore((state) => state.chatMode);
  const companionTheme = useWorkspaceStore((state) => state.companionTheme);
  const setActiveProfileId = useWorkspaceStore((state) => state.setActiveProfileId);
  const setChatMode = useWorkspaceStore((state) => state.setChatMode);
  const setCompanionTheme = useWorkspaceStore((state) => state.setCompanionTheme);
  const queryClient = useQueryClient();
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: fetchHealth });
  const profilesQuery = useQuery({ queryKey: ['profiles-settings'], queryFn: fetchProfiles });
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
      await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      await queryClient.invalidateQueries({ queryKey: ['profiles-page'] });
      await queryClient.invalidateQueries({ queryKey: ['profiles-settings'] });
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['sessions-index'] });
    },
    onError: (error, requestedProfileId) => {
      logProfileDebug('settings-switch-error', {
        requestedProfileId,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const isHealthLoading = healthQuery.isLoading;
  const isProfilesLoading = profilesQuery.isLoading;

  return (
    <div className="companion-page companion-page--interior flex h-full min-h-0 flex-col overflow-hidden">
        <div className="companion-aura companion-aura--main" aria-hidden="true" />
        <div className="companion-aura companion-aura--lower" aria-hidden="true" />
        <PageTitlebar className="companion-chat-panel relative z-10 border-b-0" title={<h2 className="truncate text-base font-semibold tracking-tight">连接与健康设置</h2>} />
        <div className='relative z-10 h-full space-y-4 overflow-auto p-4 lg:p-6'>
          <Tabs defaultValue="health" className="space-y-1">
            <TabsList className="bg-white/42 backdrop-blur-xl">
              <TabsTrigger value="health">健康检查</TabsTrigger>
              <TabsTrigger value="env">环境配置</TabsTrigger>
            </TabsList>
            <TabsContent value="health" className="grid gap-4 lg:grid-cols-2">
              {isHealthLoading ? (
                <>
                  <div className="lg:col-span-2">
                    <LoadingLabel />
                  </div>
                  <StatusCardSkeleton />
                </>
              ) : (
                (healthQuery.data?.items ?? []).map((item) => <StatusCard key={item.key} item={item} />)
              )}
            </TabsContent>
            <TabsContent value="env">
              {isProfilesLoading && isHealthLoading ? (
                <div className="space-y-4">
                  <LoadingLabel />
                  <SettingsPanelSkeleton />
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="companion-glass rounded-2xl p-4">
                    <div className="mb-3 text-sm font-medium">当前 Profile</div>
                    {isProfilesLoading ? (
                      <div className="space-y-3">
                        <LoadingLabel />
                        <SettingsPanelSkeleton />
                      </div>
                    ) : (
                      <>
                        <Select value={activeProfileId} onValueChange={(value) => switchProfileMutation.mutate(value)}>
                          <SelectTrigger>
                            <SelectValue placeholder="选择当前 Profile" />
                          </SelectTrigger>
                          <SelectContent>
                            {(profilesQuery.data?.profiles ?? []).map((profile) => (
                              <SelectItem key={profile.id} value={profile.id}>
                                {profile.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="mt-3 text-sm text-muted-foreground">切换后，聊天和会话列表会自动绑定到目标 profile。</p>
                      </>
                    )}
                  </div>

                  <div className="companion-glass rounded-2xl p-4">
                    <div className="mb-3 text-sm font-medium">界面主题</div>
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
                    <p className="mt-3 text-sm text-muted-foreground">首页和内页背景、光晕、ShapeBlur 与主操作色会同步更新。</p>
                  </div>

                  <div className="companion-glass rounded-2xl p-4">
                    <div className="mb-3 text-sm font-medium">聊天协议模式</div>
                    <Select value={chatMode} onValueChange={(value: 'responses' | 'chat-completions') => setChatMode(value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择 Hermes 协议模式" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="responses">responses</SelectItem>
                        <SelectItem value="chat-completions">chat-completions</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="mt-3 text-sm text-muted-foreground">当前已接入前端共享状态。后续可继续与 companion 和真实 Hermes 配置联动。</p>
                  </div>

                  <div className="companion-glass rounded-2xl p-4 text-sm text-muted-foreground lg:col-span-2">
                    <div className="mb-2 font-medium text-foreground">当前探测到的连接信息</div>
                    {isHealthLoading ? (
                      <div className="space-y-3">
                        <LoadingLabel />
                        <div className="space-y-2">
                          <SettingsPanelSkeleton />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>Hermes 根目录：{healthQuery.data?.detected.hermesRoot ?? '未探测到'}</div>
                        <div>API Server：{healthQuery.data?.detected.apiBaseUrl ?? '未探测到'}</div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
    </div>
  );
}
