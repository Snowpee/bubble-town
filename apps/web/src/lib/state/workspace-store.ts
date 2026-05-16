import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface WorkspaceState {
  activeProfileId?: string;
  chatMode: 'responses' | 'chat-completions';
  assistantMessageViewMode: 'bubble' | 'document';
  setActiveProfileId: (profileId?: string) => void;
  setChatMode: (chatMode: 'responses' | 'chat-completions') => void;
  setAssistantMessageViewMode: (viewMode: 'bubble' | 'document') => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      activeProfileId: undefined,
      chatMode: 'responses',
      assistantMessageViewMode: 'bubble',
      setActiveProfileId: (activeProfileId) => set({ activeProfileId }),
      setChatMode: (chatMode) => set({ chatMode }),
      setAssistantMessageViewMode: (assistantMessageViewMode) => set({ assistantMessageViewMode }),
    }),
    {
      name: 'bubble-town-workspace',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeProfileId: state.activeProfileId,
        chatMode: state.chatMode,
        assistantMessageViewMode: state.assistantMessageViewMode,
      }),
    },
  ),
);
