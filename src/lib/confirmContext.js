import { createContext, useContext } from 'react'

export const ConfirmContext = createContext(null)

// Returns confirm({ title, message, confirmLabel, cancelLabel, tone }) ->
// Promise<boolean>. The one way any component asks "are you sure?" — see
// ConfirmProvider.jsx for the rule it enforces. Falls back to the browser's
// native dialog only if a screen is ever rendered outside the provider, so
// a destructive action can never silently skip its confirmation.
export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (confirm) return confirm
  return async ({ title, message }) => window.confirm([title, message].filter(Boolean).join('\n\n'))
}
