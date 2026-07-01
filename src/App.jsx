import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { UsersProvider } from './lib/users'
import { EmojisProvider } from './lib/emojis'
import Login from './components/Login'
import Loading from './components/Loading'
import AppShell from './components/AppShell'
import DMsHome from './views/DMsHome'
import DMConvo from './views/DMConvo'
import MyNotes from './views/MyNotes'
import GroupHome from './views/GroupHome'
import Channel from './views/Channel'
import AdminPanel from './views/AdminPanel'

export default function App() {
  return (
    <AuthProvider>
      <UsersProvider>
        <EmojisProvider>
          <Gate />
        </EmojisProvider>
      </UsersProvider>
    </AuthProvider>
  )
}

function Gate() {
  const { user, profile, loading } = useAuth()
  if (loading) return <Loading label="Signing you in" />
  if (!user || !profile) return <Login />

  return (
    <Routes>
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
    </Routes>
  )
}
