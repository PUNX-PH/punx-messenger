import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { UsersProvider } from './lib/users'
import { EmojisProvider } from './lib/emojis'
import { PresenceHeartbeat, PresenceTickProvider } from './lib/presence'
import { NotificationDaemon, NotificationsProvider } from './lib/notifications'
import { CallProvider } from './lib/useCall'
import { VoiceChannelProvider } from './lib/useVoiceChannel'
import Login from './components/Login'
import Loading from './components/Loading'
import AppShell from './components/AppShell'
import CallManager from './components/calls/CallManager'
import DMsHome from './views/DMsHome'
import DMConvo from './views/DMConvo'
import MyNotes from './views/MyNotes'
import GroupHome from './views/GroupHome'
import Channel from './views/Channel'
import AdminPanel from './views/AdminPanel'
import InviteAccept from './views/InviteAccept'

export default function App() {
  return (
    <AuthProvider>
      <UsersProvider>
        <PresenceTickProvider>
          <NotificationsProvider>
            <EmojisProvider>
              <PresenceHeartbeat />
              <NotificationDaemon />
              <CallProvider>
                <CallManager />
                <VoiceChannelProvider>
                  <Gate />
                </VoiceChannelProvider>
              </CallProvider>
            </EmojisProvider>
          </NotificationsProvider>
        </PresenceTickProvider>
      </UsersProvider>
    </AuthProvider>
  )
}

function Gate() {
  const { user, profile, loading } = useAuth()
  if (loading) return <Loading label="Signing you in" />

  return (
    <Routes>
      {/* Outside the login wall on purpose. An invited outsider arrives with no
          account, and after signing in still has no profile — firestore.rules
          gives them nothing until they redeem — so this route has to render in
          both of those states. It is the only one that does. */}
      <Route path="/invite/:token" element={<InviteAccept />} />

      {!user || !profile ? (
        <Route path="*" element={<Login />} />
      ) : (
        <Route element={<AppShell />}>
          <Route path="/"                          element={<Navigate to="/dms" replace />} />
          <Route path="/dms"                       element={<DMsHome />} />
          <Route path="/dms/:otherUid"             element={<DMConvo />} />
          <Route path="/me/notes"                  element={<MyNotes />} />
          <Route path="/g/:groupId"                element={<GroupHome />} />
          <Route path="/g/:groupId/c/:channelId"   element={<Channel />} />
          <Route path="/admin"                     element={<AdminPanel />} />
          <Route path="*"                          element={<Navigate to="/dms" replace />} />
        </Route>
      )}
    </Routes>
  )
}
