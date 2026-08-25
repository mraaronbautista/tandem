import { useEffect, useState } from 'react'

function systemPreference() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || systemPreference())

  // Shadow tokens (--shadow-resting etc.) are theme-dependent custom
  // properties consumed via var() by many `transition: box-shadow`
  // rules (soft tactile elevation — see App.css). Blink doesn't reliably
  // re-run those transitions when the *only* thing that changed is an
  // inherited custom property on an ancestor (as opposed to a state
  // change on the element itself, e.g. :hover) — box-shadow gets stuck
  // showing the old theme's color until some other interaction forces a
  // recompute. Briefly killing all transitions across the switch (a
  // standard "disable transitions on theme change" trick) sidesteps it:
  // the new value still applies instantly, just without an incorrect
  // stuck-mid-transition render in between.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('theme-transitioning')
    root.setAttribute('data-theme', theme)
    void root.offsetHeight
    const id = requestAnimationFrame(() => root.classList.remove('theme-transitioning'))
    return () => cancelAnimationFrame(id)
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
