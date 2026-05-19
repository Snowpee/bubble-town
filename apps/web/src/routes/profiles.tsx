import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus } from 'lucide-react';
import { DEFAULT_PROFILE_ID, type ProfileSummary, type ProfilesResponse } from '@bubble-town/shared';
import { PageTitlebar } from '@/components/layout/page-titlebar';
import { LoadingLabel, ProfileGridSkeleton } from '@/components/loading/loading-state';
import { createProfile, deleteProfile, fetchProfiles, renameProfile, switchProfile } from '@/lib/api/profiles';
import { markActiveProfileInResponse } from '@/lib/api/profile-cache';
import { logProfileDebug } from '@/lib/debug/profile-debug';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type DialogMode = 'create' | 'rename' | 'delete' | null;

export function ProfilesRoute() {
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const setActiveProfileId = useWorkspaceStore((state) => state.setActiveProfileId);
  const queryClient = useQueryClient();
  const profilesQuery = useQuery({ queryKey: ['profiles-page'], queryFn: fetchProfiles });
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [draftName, setDraftName] = useState('');
  const [selectedProfile, setSelectedProfile] = useState<ProfileSummary | null>(null);

  const switchProfileMutation = useMutation({
    mutationFn: (profileId: string) => {
      logProfileDebug('profiles-switch-request', {
        currentActiveProfileId: activeProfileId,
        requestedProfileId: profileId,
      });
      return switchProfile(profileId);
    },
    onSuccess: (result) => {
      const nextProfileId = result.activeProfile?.id ?? DEFAULT_PROFILE_ID;
      logProfileDebug('profiles-switch-success', {
        previousActiveProfileId: activeProfileId,
        nextProfileId,
        returnedActiveProfileId: result.activeProfile?.id,
        returnedSessionProfiles: Array.from(new Set(result.sessions.map((session) => session.profileId))),
      });
      queryClient.setQueryData<ProfilesResponse>(['profiles'], (payload) => markActiveProfileInResponse(payload, nextProfileId, result.activeProfile));
      queryClient.setQueryData<ProfilesResponse>(['profiles-page'], (payload) => markActiveProfileInResponse(payload, nextProfileId, result.activeProfile));
      queryClient.setQueryData<ProfilesResponse>(['profiles-settings'], (payload) => markActiveProfileInResponse(payload, nextProfileId, result.activeProfile));
      setActiveProfileId(nextProfileId);
      void queryClient.invalidateQueries({ queryKey: ['profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['profiles-page'] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['sessions-index'] });
    },
    onError: (error, requestedProfileId) => {
      logProfileDebug('profiles-switch-error', {
        requestedProfileId,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const createProfileMutation = useMutation({
    mutationFn: createProfile,
    onSuccess: async () => {
      setDraftName('');
      setDialogMode(null);
      await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      await queryClient.invalidateQueries({ queryKey: ['profiles-page'] });
    },
  });

  const renameProfileMutation = useMutation({
    mutationFn: ({ profileId, name }: { profileId: string; name: string }) => renameProfile(profileId, { name }),
    onSuccess: async () => {
      setDraftName('');
      setDialogMode(null);
      setSelectedProfile(null);
      await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      await queryClient.invalidateQueries({ queryKey: ['profiles-page'] });
    },
  });

  const deleteProfileMutation = useMutation({
    mutationFn: deleteProfile,
    onSuccess: async () => {
      setDialogMode(null);
      setSelectedProfile(null);
      await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      await queryClient.invalidateQueries({ queryKey: ['profiles-page'] });
    },
  });

  const submitDisabled = useMemo(() => {
    if (dialogMode === 'create' || dialogMode === 'rename') {
      return !draftName.trim();
    }
    return false;
  }, [dialogMode, draftName]);

  function openCreateDialog() {
    setDraftName('');
    setSelectedProfile(null);
    setDialogMode('create');
  }

  function openRenameDialog(profile: ProfileSummary) {
    setSelectedProfile(profile);
    setDraftName(profile.name);
    setDialogMode('rename');
  }

  function openDeleteDialog(profile: ProfileSummary) {
    setSelectedProfile(profile);
    setDraftName(profile.name);
    setDialogMode('delete');
  }

  async function handleDialogSubmit() {
    if (dialogMode === 'create' && draftName.trim()) {
      await createProfileMutation.mutateAsync({ name: draftName.trim() });
    }

    if (dialogMode === 'rename' && selectedProfile && draftName.trim()) {
      await renameProfileMutation.mutateAsync({ profileId: selectedProfile.id, name: draftName.trim() });
    }

    if (dialogMode === 'delete' && selectedProfile) {
      await deleteProfileMutation.mutateAsync(selectedProfile.id);
    }
  }

  const pending = switchProfileMutation.isPending || createProfileMutation.isPending || renameProfileMutation.isPending || deleteProfileMutation.isPending;
  const isLoading = profilesQuery.isLoading;

  return (
    <>
      <div>
        <PageTitlebar
          title={<h2 className="truncate text-base font-semibold tracking-tight">Profile 管理</h2>}
          actions={
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            <span className="ml-2">新建 Profile</span>
          </Button>
          }
        />
        <div className="space-y-4 p-4 lg:p-6">
          {isLoading ? (
            <>
              <LoadingLabel />
              <ProfileGridSkeleton />
            </>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(profilesQuery.data?.profiles ?? []).map((profile) => (
                <div key={profile.id} className="rounded-3xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{profile.name}</div>
                      <div className="text-xs text-muted-foreground">{profile.id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={profile.isActive ? 'default' : 'secondary'}>{profile.isActive ? '激活中' : '待机'}</Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Profile 操作</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => switchProfileMutation.mutate(profile.id)}>切换到此 profile</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openRenameDialog(profile)}>重命名</DropdownMenuItem>
                          <DropdownMenuItem disabled={profile.isActive} onClick={() => openDeleteDialog(profile)}>
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                    <span>{profile.sessionCount ?? 0} 个会话</span>
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => switchProfileMutation.mutate(profile.id)}>
                      {activeProfileId === profile.id ? '当前 profile' : '切换'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && setDialogMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'create' && '新建 Profile'}
              {dialogMode === 'rename' && '重命名 Profile'}
              {dialogMode === 'delete' && '删除 Profile'}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === 'create' && '创建后可切换到新的工作上下文，并加载该 profile 下的独立会话。'}
              {dialogMode === 'rename' && '修改当前 profile 的展示名称，不影响其上下文边界。'}
              {dialogMode === 'delete' && '删除前请确认该 profile 不是当前激活项。'}
            </DialogDescription>
          </DialogHeader>

          {dialogMode === 'delete' ? (
            <div className="rounded-2xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
              确认删除 <span className="font-medium text-foreground">{selectedProfile?.name}</span> 吗？此操作会移除该 profile 的入口。
            </div>
          ) : (
            <Input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="输入 profile 名称" />
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogMode(null)}>
              取消
            </Button>
            <Button disabled={pending || submitDisabled} onClick={() => void handleDialogSubmit()}>
              {dialogMode === 'delete' ? '确认删除' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
