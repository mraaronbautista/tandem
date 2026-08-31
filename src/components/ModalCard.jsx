// Thin React wrapper around .submission-modal (App.css:2480-2489) — NOT
// a CSS-to-Tailwind conversion like IconButton/PeriodTabs/MonthNavRow.
// .submission-modal's literal class name is load-bearing for far more
// than its own box recipe: .modal-backdrop .submission-modal (Modal.jsx's
// own backdrop, untouched) drives all of its responsive sizing/
// positioning/slide-up-sheet animation, .submission-modal.<modifier>
// drives 5 real per-modal fixed-size overrides (how-to-guide-modal,
// vault-modal, date-picker-modal, settings-modal, eod-report-modal), and
// .submission-modal h2 / .submission-modal label style arbitrary,
// un-converted internal content across all 17 consumers. Renaming the
// class away would mean duplicating every one of those selectors onto a
// new class and auditing every consumer's internals for anything else
// keyed off it — real blast radius for a step whose actual value here is
// deduplicating 17 near-identical call sites, not converting CSS. So
// this keeps emitting the literal "submission-modal" class unchanged;
// none of App.css's rules for it are touched.
//
// `as`: 'div' (default) or 'form' — roughly half of the real consumers
// are forms (onSubmit).
// `modifier`: a literal class alongside "submission-modal" — either one
// of the 5 real size overrides above, or a purely-internal scoping hook
// a consumer's own descendant rules key off (e.g. bulk-add-modal, for
// BulkAddTasksForm's own select/textarea sizing) — both cases are just a
// class name from this component's point of view.
export default function ModalCard({ as = 'div', modifier = '', className = '', ...props }) {
  const Tag = as
  return (
    <Tag
      className={['submission-modal', modifier, className].filter(Boolean).join(' ')}
      onClick={(e) => e.stopPropagation()}
      {...props}
    />
  )
}
