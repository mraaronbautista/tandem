import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading, null = signed out
  const [authError, setAuthError] = useState(null)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    setAuthError(null)
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch((err) => setAuthError(err))

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [retryCount])

  const value = {
    session,
    loading: session === undefined && !authError,
    authError,
    retry: () => setRetryCount((n) => n + 1),
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
