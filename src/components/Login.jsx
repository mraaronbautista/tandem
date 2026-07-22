import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ThemeToggle from './ThemeToggle'

export default function Login({ theme, toggleTheme }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | sent | error
  const [error, setError] = useState('')

  async function handleSubmit(e) {
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
      <h1>PsyberScribe</h1>
      <p>Sign in with the email address invited to this board.</p>

      {status === 'sent' ? (
        <p className="login-sent">Check {email} for a sign-in link.</p>
      ) : (
        <form onSubmit={handleSubmit} className="login-form">
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
      )}
    </div>
  )
}
