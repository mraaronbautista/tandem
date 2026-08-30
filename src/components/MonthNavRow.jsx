// .month-nav-row/.month-nav-label(-button) (App.css:2897-2934) — a
// generic "‹ Month Year ›" nav row shared by RentalsView's Calendar tab
// (mobile) and Today's clickable month header, neither related to the
// other (kept the original CSS comment's neutral naming/reasoning).
// .month-nav-arrows/.month-nav-today-button are single-consumer
// (TaskBoard.jsx only) and are converted inline there, not extracted here.
export function MonthNavRow({ className = '', ...props }) {
  return (
    <div
      className={`flex items-center justify-center gap-3.5 font-semibold text-text-h max-[480px]:gap-2.5 ${className}`}
      {...props}
    />
  )
}

// Fixed min-width so the row's arrows (when present) don't drift left/
// right as the label's own text width changes between months — dropped
// under 480px (RentalsView's own comment: room for the header's other
// half once things wrap to their own line on a narrow phone).
//
// Renders as a <button> only when onClick is given (TaskBoard.jsx's
// clickable Today-tab header, opens DatePickerModal) — RentalsView's
// nav rows use the plain <span> the class started as. The button branch
// needs explicit color/font inheritance ([color:inherit],
// [font-family:inherit], [line-height:inherit]) because a <button>
// doesn't inherit either by default without Preflight, same fix already
// used in AllDayRow.jsx.
export function MonthNavLabel({ onClick, className = '', ...props }) {
  const shared = 'inline-block min-w-[150px] text-center max-[480px]:min-w-0'
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${shared} inline-flex cursor-pointer items-center justify-center gap-1 border-0 bg-transparent font-semibold [color:inherit] [font-family:inherit] [line-height:inherit] ${className}`}
        {...props}
      />
    )
  }
  return <span className={`${shared} ${className}`} {...props} />
}
