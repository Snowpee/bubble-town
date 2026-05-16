import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchHealth } from '@/lib/api/hermes';
import { fetchProfiles, switchProfile } from '@/lib/api/profiles';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { StatusCard } from '@/components/hermes/status-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function SettingsRoute() {
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const chatMode = useWorkspaceStore((state) => state.chatMode);
  const setActiveProfileId = useWorkspaceStore((state) => state.setActiveProfileId);
  const setChatMode = useWorkspaceStore((state) => state.setChatMode);
  const queryClient = useQueryClient();
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: fetchHealth });
  const profilesQuery = useQuery({ queryKey: ['profiles-settings'], queryFn: fetchProfiles });
  const switchProfileMutation = useMutation({
    mutationFn: switchProfile,
    onSuccess: async (result) => {
      setActiveProfileId(result.activeProfile?.id);
      await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      await queryClient.invalidateQueries({ queryKey: ['profiles-page'] });
      await queryClient.invalidateQueries({ queryKey: ['profiles-settings'] });
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['sessions-index'] });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>连接与健康设置</CardTitle>
          <CardDescription>当前显示的是 companion 健康检查骨架结果，后续会替换为真实的 Hermes 环境探测。</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="health" className="space-y-4">
            <TabsList>
              <TabsTrigger value="health">健康检查</TabsTrigger>
              <TabsTrigger value="env">环境配置</TabsTrigger>
            </TabsList>
            <TabsContent value="health" className="grid gap-4 lg:grid-cols-2">
              {healthQuery.isLoading
                ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-36 rounded-2xl" />)
                : (healthQuery.data?.items ?? []).map((item) => <StatusCard key={item.key} item={item} />)}
            </TabsContent>
            <TabsContent value="env">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-border bg-card/60 p-4">
                  <div className="mb-3 text-sm font-medium">当前 Profile</div>
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
                </div>

                <div className="rounded-2xl border border-border bg-card/60 p-4">
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

                <div className="rounded-2xl border border-border bg-card/60 p-4 text-sm text-muted-foreground lg:col-span-2">
                  <div className="mb-2 font-medium text-foreground">当前探测到的连接信息</div>
                  <div>Hermes 根目录：{healthQuery.data?.detected.hermesRoot ?? '未探测到'}</div>
                  <div>API Server：{healthQuery.data?.detected.apiBaseUrl ?? '未探测到'}</div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
