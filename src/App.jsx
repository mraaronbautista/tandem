import './App.css'
import { useAuth } from './lib/AuthContext'
import { useTheme } from './lib/useTheme'
import Login from './components/Login'
import TaskBoard from './components/TaskBoard'

function App() {
  const { session, loading } = useAuth()
  const { theme, toggleTheme } = useTheme()

  if (loading) return <div className="app-loading">Loading…</div>

  return session ? (
    <TaskBoard theme={theme} toggleTheme={toggleTheme} />
  ) : (
    <Login theme={theme} toggleTheme={toggleTheme} />
  )
}

export default App
