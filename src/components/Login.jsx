import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ThemeToggle from './ThemeToggle'

const loginFormClasses =
  'flex flex-col gap-2.5 [&_button]:cursor-pointer [&_button]:rounded-[8px] [&_button]:border-0 [&_button]:bg-accent [&_button]:px-3 [&_button]:py-2.5 [&_button]:font-semibold [&_button]:text-white [&_button:hover]:bg-accent-h [&_input]:rounded-sm [&_input]:border [&_input]:border-border [&_input]:bg-card-bg [&_input]:px-3 [&_input]:py-2.5 [&_input]:text-[15px] [&_input]:text-text-h'

// Every real account (Ada, Aaron, and any staff account) logs in with a
// short username ("aaron", not an email) rather than a real address —
// Supabase's password auth is still built around email as the
// identifier underneath (there's no native "sign in by username" call),
// so this just appends a fixed placeholder domain before the actual
// signInWithPassword call, entirely client-side. Typing a full address
// with an "@" in it still works unchanged — this is additive, not a
// hard requirement, so an account that still has a real email keeps
// working during the transition.
//
// Lowercased explicitly, not just trimmed — a plain type="text" input
// (needed so a bare username is allowed at all, unlike type="email")
// doesn't get the browser's usual case handling for free, and mobile
// keyboards commonly auto-capitalize the first letter of a fresh text
// field by default. autoCapitalize="none" below already asks the
// keyboard not to do that, but this is the actual guarantee — it can't
// silently send e.g. "Aaron@tandem.local" (a login that looks valid but
// won't match the tandem.local row Aaron's real account uses) no matter
// what any given keyboard/OS/autofill does upstream of it.
function toLoginEmail(input) {
  const trimmed = input.trim().toLowerCase()
  return trimmed.includes('@') ? trimmed : `${trimmed}@tandem.local`
}

// Password is the only sign-in method — the magic-link fallback this
// used to have was removed once Ada/Aaron's actual auth emails became
// the @tandem.local placeholders above: signInWithOtp needs a real,
// working inbox to deliver the link to, and neither account has one
// anymore, so the fallback stopped being able to reach anyone.
export default function Login({ theme, toggleTheme }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | error
  const [error, setError] = useState('')

  async function handlePasswordSubmit(e) {
    e.preventDefault()
    setStatus('sending')
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email: toLoginEmail(email), password })

    if (error) {
      setStatus('error')
      setError(error.message)
      return
    }

    // No further action needed on success — AuthContext's onAuthStateChange
    // picks up the new session and swaps the login screen out on its own.
  }

  return (
    <div className="mx-auto mt-[20svh] max-w-[360px] px-6 text-center">
      <div className="mb-1 flex justify-end">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
      <h1 className="mb-2 text-[28px]">Tandem</h1>
      <p className="mb-5 text-sm opacity-65">A web app built for Ada</p>

      <form onSubmit={handlePasswordSubmit} className={loginFormClasses}>
        <label className="visually-hidden" htmlFor="login-username">
          Username
        </label>
        <input
          id="login-username"
          type="text"
          required
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          placeholder="Username"
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
    </div>
  )
}
