import { AuthProvider, useAuth } from './lib/auth'
import Login from './components/Login'
import Loading from './components/Loading'
import AppShell from './components/AppShell'

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

function Gate() {
  const { user, profile, loading } = useAuth()
  if (loading) return <Loading label="Signing you in" />
  if (!user || !profile) return <Login />
  return <AppShell />
}
