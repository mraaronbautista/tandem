// The mobile-only bottom nav shell (a2-inspired floating capsule), mounted
// by TaskBoard.jsx in place of the old full-width .task-board-nav bar —
// see TaskBoard.jsx's isDesktop branch. Purely presentational: it renders
// whatever nav buttons/FAB it's handed, no state or data fetching of its
// own. `children` is the FAB trigger (NewTaskForm variant="mobile"),
// rendered as a flex sibling of the capsule so the two form one centered
// group, matching a2's AppShell nav — not two independently `fixed`
// elements the way the old bar + FAB used to be.
export default function MobileNav({ navButtons, children }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-3 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
      <div className="flex items-center gap-1 rounded-full border border-border bg-card-bg p-1.5 shadow-floating">
        {navButtons}
      </div>
      {children}
    </nav>
  )
}
