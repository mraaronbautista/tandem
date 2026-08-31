import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ThemeToggle from './ThemeToggle'

const loginFormClasses =
  'flex flex-col gap-2.5 [&_button]:cursor-pointer [&_button]:rounded-[8px] [&_button]:border-0 [&_button]:bg-accent [&_button]:px-3 [&_button]:py-2.5 [&_button]:font-semibold [&_button]:text-white [&_button:hover]:bg-accent-h [&_input]:rounded-sm [&_input]:border [&_input]:border-border [&_input]:bg-card-bg [&_input]:px-3 [&_input]:py-2.5 [&_input]:text-[15px] [&_input]:text-text-h'

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
  // Separate from `status` — status is transient (flips through
  // 'sending' again on a resend), but once a link has been sent once the
  // "check your email" screen should stay up rather than the form
  // reappearing mid-resend.
  const [magicLinkSent, setMagicLinkSent] = useState(false)

  function switchMode() {
    setMode((m) => (m === 'password' ? 'magic-link' : 'password'))
    setStatus('idle')
    setError('')
    setMagicLinkSent(false)
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

  async function sendMagicLink() {
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
    setMagicLinkSent(true)
  }

  function handleMagicLinkSubmit(e) {
    e.preventDefault()
    sendMagicLink()
  }

  return (
    <div className="mx-auto mt-[20svh] max-w-[360px] px-6 text-center">
      <div className="mb-1 flex justify-end">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
      <h1 className="mb-2 text-[28px]">Tandem</h1>
      <p className="mb-5 text-sm opacity-65">A web app built for Ada</p>

      {mode === 'password' && (
        <form onSubmit={handlePasswordSubmit} className={loginFormClasses}>
          <label className="visually-hidden" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label className="visually-hidden" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Signing in…' : 'Sign in'}
          </button>
          {status === 'error' && <p className="mb-5 text-sm text-overdue">{error}</p>}
        </form>
      )}

      {mode === 'magic-link' &&
        (magicLinkSent ? (
          <div className={loginFormClasses}>
            <p className="mb-5 rounded-[8px] border border-border bg-card-bg p-4">Check {email} for a sign-in link.</p>
            <button type="button" onClick={sendMagicLink} disabled={status === 'sending'}>
              {status === 'sending' ? 'Resending…' : 'Resend link'}
            </button>
            {status === 'error' && <p className="mb-5 text-sm text-overdue">{error}</p>}
          </div>
        ) : (
          <form onSubmit={handleMagicLinkSubmit} className={loginFormClasses}>
            <label className="visually-hidden" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" disabled={status === 'sending'}>
              {status === 'sending' ? 'Sending link…' : 'Send sign-in link'}
            </button>
            {status === 'error' && <p className="mb-5 text-sm text-overdue">{error}</p>}
          </form>
        ))}

      <button type="button" className="mx-auto mt-3.5 block cursor-pointer border-0 bg-transparent text-[13px] text-accent underline" onClick={switchMode}>
        {mode === 'password' ? 'Use a magic link instead' : 'Use a password instead'}
      </button>
    </div>
  )
}
