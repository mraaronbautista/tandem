export function timeOfDayGreeting(name) {
  const hour = new Date().getHours()
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  return `Good ${part}${name ? `, ${name}` : ''}`
}
