import { useEffect } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/app-shell';
import { fetchProfiles } from '@/lib/api/profiles';
import { useWorkspaceStore } from '@/lib/state/workspace-store';
import { ChatRoute } from '@/routes/chat';
import { ProfilesRoute } from '@/routes/profiles';
import { SessionsRoute } from '@/routes/sessions';
import { SettingsRoute } from '@/routes/settings';

export default function App() {
  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: fetchProfiles });
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const setActiveProfileId = useWorkspaceStore((state) => state.setActiveProfileId);

  useEffect(() => {
    if (!activeProfileId && profilesQuery.data?.activeProfileId) {
      setActiveProfileId(profilesQuery.data.activeProfileId);
    }
  }, [activeProfileId, profilesQuery.data?.activeProfileId, setActiveProfileId]);

  return (
    <Router>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatRoute />} />
          <Route path="/chat/:sessionId" element={<ChatRoute />} />
          <Route path="/sessions" element={<SessionsRoute />} />
          <Route path="/profiles" element={<ProfilesRoute />} />
          <Route path="/settings" element={<SettingsRoute />} />
        </Routes>
      </AppShell>
    </Router>
  );
}
