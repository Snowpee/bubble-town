import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_PROFILE_ID } from '@bubble-town/shared';

interface WorkspaceState {
  activeProfileId: string;
  activeStorylineId?: string;
  chatMode: 'responses' | 'chat-completions';
  assistantMessageViewMode: 'bubble' | 'document';
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  mobileSidebarOpen: boolean;
  setActiveProfileId: (profileId: string) => void;
  setActiveStorylineId: (storylineId?: string) => void;
  setChatMode: (chatMode: 'responses' | 'chat-completions') => void;
  setAssistantMessageViewMode: (viewMode: 'bubble' | 'document') => void;
  setSidebarCollapsed: (sidebarCollapsed: boolean) => void;
  setSidebarWidth: (sidebarWidth: number) => void;
  setMobileSidebarOpen: (mobileSidebarOpen: boolean) => void;
}

const DEFAULT_SIDEBAR_WIDTH = 304;
const MIN_SIDEBAR_WIDTH = 256;
const MAX_SIDEBAR_WIDTH = 384;

function normalizeSidebarWidth(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value))
    : DEFAULT_SIDEBAR_WIDTH;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      activeProfileId: DEFAULT_PROFILE_ID,
      activeStorylineId: undefined,
      chatMode: 'responses',
      assistantMessageViewMode: 'bubble',
      sidebarCollapsed: false,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      mobileSidebarOpen: false,
      setActiveProfileId: (activeProfileId) => set({ activeProfileId }),
      setActiveStorylineId: (activeStorylineId) => set({ activeStorylineId }),
      setChatMode: (chatMode) => set({ chatMode }),
      setAssistantMessageViewMode: (assistantMessageViewMode) => set({ assistantMessageViewMode }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: normalizeSidebarWidth(sidebarWidth) }),
      setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
    }),
    {
      name: 'bubble-town-workspace',
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const persistedState = persisted && typeof persisted === 'object' ? (persisted as Partial<WorkspaceState>) : {};
        return {
          ...current,
          ...persistedState,
          mobileSidebarOpen: false,
          sidebarWidth: normalizeSidebarWidth(persistedState.sidebarWidth),
          activeProfileId:
            typeof persistedState.activeProfileId === 'string' && persistedState.activeProfileId.trim()
              ? persistedState.activeProfileId
              : DEFAULT_PROFILE_ID,
          activeStorylineId:
            typeof persistedState.activeStorylineId === 'string' && persistedState.activeStorylineId.trim()
              ? persistedState.activeStorylineId
              : undefined,
        };
      },
      partialize: (state) => ({
        activeProfileId: state.activeProfileId,
        activeStorylineId: state.activeStorylineId,
        chatMode: state.chatMode,
        assistantMessageViewMode: state.assistantMessageViewMode,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarWidth: state.sidebarWidth,
      }),
    },
  ),
);
