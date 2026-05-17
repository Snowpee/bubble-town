import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_PROFILE_ID } from '@bubble-town/shared';

interface WorkspaceState {
  activeProfileId: string;
  chatMode: 'responses' | 'chat-completions';
  assistantMessageViewMode: 'bubble' | 'document';
  setActiveProfileId: (profileId: string) => void;
  setChatMode: (chatMode: 'responses' | 'chat-completions') => void;
  setAssistantMessageViewMode: (viewMode: 'bubble' | 'document') => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      activeProfileId: DEFAULT_PROFILE_ID,
      chatMode: 'responses',
      assistantMessageViewMode: 'bubble',
      setActiveProfileId: (activeProfileId) => set({ activeProfileId }),
      setChatMode: (chatMode) => set({ chatMode }),
      setAssistantMessageViewMode: (assistantMessageViewMode) => set({ assistantMessageViewMode }),
    }),
    {
      name: 'bubble-town-workspace',
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const persistedState = persisted && typeof persisted === 'object' ? (persisted as Partial<WorkspaceState>) : {};
        return {
          ...current,
          ...persistedState,
          activeProfileId:
            typeof persistedState.activeProfileId === 'string' && persistedState.activeProfileId.trim()
              ? persistedState.activeProfileId
              : DEFAULT_PROFILE_ID,
        };
      },
      partialize: (state) => ({
        activeProfileId: state.activeProfileId,
        chatMode: state.chatMode,
        assistantMessageViewMode: state.assistantMessageViewMode,
      }),
    },
  ),
);
