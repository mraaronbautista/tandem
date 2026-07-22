import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ThemeToggle from './ThemeToggle'

// Password is the default sign-in method — magic link requires bouncing
// through the device's default browser to click the email link, which
// breaks entirely for a Home Screen "Add to Home Screen" install on iOS
// (that runs in its own isolated storage with no address bar to land the
// redirect in). Password sign-in has no redirect step, so it works
// everywhere. Magic link stays available as a fallback in case the
// mail-sending setup ever needs bypassing again.
export default function Login({ theme, toggleTheme }) {
  const [mode, setMode] = useState('password') // 'password' | 'magic-link'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | sent | error
  const [error, setError] = useState('')

  function switchMode() {
    setMode((m) => (m === 'password' ? 'magic-link' : 'password'))
    setStatus('idle')
    setError('')
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault()
    setStatus('sending')
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setStatus('error')
      setError(error.message)
      return
    }

    // No further action needed on success — AuthContext's onAuthStateChange
    // picks up the new session and swaps the login screen out on its own.
  }

  async function handleMagicLinkSubmit(e) {
    e.preventDefault()
    setStatus('sending')
    setError('')

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })

    if (error) {
      setStatus('error')
      setError(error.message)
      return
    }

    setStatus('sent')
  }

  return (
    <div className="login-screen">
      <div className="login-theme-toggle">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
      <h1>Tandem</h1>
      <p className="login-tagline">A web app built for Ada</p>

      {mode === 'password' && (
        <form onSubmit={handlePasswordSubmit} className="login-form">
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Signing in…' : 'Sign in'}
          </button>
          {status === 'error' && <p className="login-error">{error}</p>}
        </form>
      )}

      {mode === 'magic-link' &&
        (status === 'sent' ? (
          <p className="login-sent">Check {email} for a sign-in link.</p>
        ) : (
          <form onSubmit={handleMagicLinkSubmit} className="login-form">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" disabled={status === 'sending'}>
              {status === 'sending' ? 'Sending link…' : 'Send sign-in link'}
            </button>
            {status === 'error' && <p className="login-error">{error}</p>}
          </form>
        ))}

      <button type="button" className="login-mode-toggle" onClick={switchMode}>
        {mode === 'password' ? 'Use a magic link instead' : 'Use a password instead'}
      </button>
    </div>
  )
}
