import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { ChatRoute } from '@/routes/chat';
import Home from '@/pages/Home';
import { ProfilesRoute } from '@/routes/profiles';
import { SessionsRoute } from '@/routes/sessions';
import { SettingsRoute } from '@/routes/settings';
import { StoryChatRoute } from '@/routes/story-chat';

export default function App() {
  const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;

  return (
    <Router>
      <AppShell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/chat" element={<StoryChatRoute />} />
          <Route path="/legacy-chat" element={<ChatRoute />} />
          <Route path="/legacy-chat/:sessionId" element={<ChatRoute />} />
          <Route path="/sessions" element={<SessionsRoute />} />
          <Route path="/profiles" element={<ProfilesRoute />} />
          <Route path="/settings" element={<SettingsRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </Router>
  );
}
