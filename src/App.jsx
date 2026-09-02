import { useEffect } from 'react'
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

  // iOS/WKWebView can leave position:fixed elements (the bottom nav,
  // modal sheets) visually detached from the viewport after the PWA has
  // sat backgrounded for a while — the screen locks overnight, the
  // calendar day rolls over, and on wake the fixed layer hasn't been
  // recomposited, so it renders as if it scrolled away with the page
  // instead of staying pinned to the bottom. A synchronous reflow when
  // the tab becomes visible again is the standard workaround for this
  // WebKit bug — nothing else in the app triggers one on its own.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      const body = document.body
      body.style.display = 'none'
      void body.offsetHeight
      body.style.display = ''
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

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
