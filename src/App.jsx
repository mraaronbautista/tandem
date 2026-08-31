import './App.css'
import { useAuth } from './lib/AuthContext'
import { useTheme } from './lib/useTheme'
import { useAccountRole } from './lib/useAccountRole'
import Login from './components/Login'
import TaskBoard from './components/TaskBoard'
import StaffClockView from './components/StaffClockView'

function App() {
  const { session, loading, authError, retry, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  // Only meaningful once a session exists — the hook itself no-ops
  // without one, staying 'loading' until called again with a real
  // session (see useAccountRole.js).
  const role = useAccountRole(session)

  if (authError) {
    return (
      <div className="app-loading app-loading-error">
        <p>Couldn't connect — try again.</p>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    )
  }

  if (loading) return <div className="app-loading">Loading…</div>

  if (!session) return <Login theme={theme} toggleTheme={toggleTheme} />

  if (role === 'loading') return <div className="app-loading">Loading…</div>

  if (role === 'staff') return <StaffClockView theme={theme} toggleTheme={toggleTheme} />

  if (role === 'blocked') {
    return (
      <div className="app-loading app-loading-error">
        <p>This account isn't set up in Tandem yet — check with Ada or Aaron.</p>
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </div>
    )
  }

  return <TaskBoard theme={theme} toggleTheme={toggleTheme} />
}

export default App
