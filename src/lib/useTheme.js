import { useEffect, useState } from 'react'

function systemPreference() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || systemPreference())

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Only follow the OS live when no explicit choice has ever been saved
  // — once toggleTheme runs below, localStorage holds a real preference
  // and this stops applying. Without this, a saved theme would fight a
  // live OS change every time this effect re-subscribes.
  useEffect(() => {
    if (localStorage.getItem('theme')) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e) => setTheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])

  const toggleTheme = () =>
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      localStorage.setItem('theme', next)
      return next
    })

  return { theme, toggleTheme }
}
