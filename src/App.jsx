import './App.css'
import { useAuth } from './lib/AuthContext'
import { useTheme } from './lib/useTheme'
import Login from './components/Login'
import TaskBoard from './components/TaskBoard'

function App() {
  const { session, loading, authError, retry } = useAuth()
  const { theme, toggleTheme } = useTheme()

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

  return session ? (
    <TaskBoard theme={theme} toggleTheme={toggleTheme} />
  ) : (
    <Login theme={theme} toggleTheme={toggleTheme} />
  )
}

export default App
