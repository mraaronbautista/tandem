import { useEffect, useRef, useState } from 'react'
import { Pin, Milestone, Inbox as InboxIcon } from 'lucide-react'
import CorkBoardView from './CorkBoardView'
import InboxView from './InboxView'
import { PeriodTabs, PeriodTab } from './PeriodTabs'
import { useMediaQuery } from '../lib/useMediaQuery'

// Left-to-right order everywhere a section index matters (the tab row,
// the swipe step below) — Projects sits between Pins and Inbox since it's
// still a kind of pin (see CorkBoardView.jsx's own mode split), not
// because of any inherent ranking.
const SECTIONS = ['pins', 'projects', 'inbox']

// Cork Board + Inbox, merged into one nav destination (Proposal A) — a
// navigation-level grouping only. Neither screen's own data/Realtime/CRUD
// logic changes; this just decides which of the three already-existing
// components renders, the same way TaskBoard.jsx's own activeTab switch
// already does for every other tab. Projects added later, once a roadmap
// pin needed its own browsing destination separate from ordinary quick
// notes — CorkBoardView itself still owns both (via its `mode` prop), so
// there's still only one component's worth of pin CRUD/comments/archive
// logic to maintain, just two different content filters over it.
export default function BoardView({ me, memberName, tasks, meId, onSelectTask, onUpdate, lastViewedAt, hasUnseenInbox, registerQuickAdd }) {
  // Inbox carried the nav's unread badge before this merge — opening
  // Board should land on whatever the badge was pointing at, not bury it
  // behind Pins by default.
  const [section, setSection] = useState(hasUnseenInbox ? 'inbox' : 'pins')
  const [focusPinRequest, setFocusPinRequest] = useState(0)

  useEffect(() => {
    if (!registerQuickAdd) return undefined
    registerQuickAdd(() => {
      setSection('pins')
      setFocusPinRequest((value) => value + 1)
    })
    return () => registerQuickAdd(null)
  }, [registerQuickAdd])

  // Self-contained, not threaded down from TaskBoard.jsx — same
  // "self-contained tab component" pattern RentalsView.jsx's own
  // isDesktop already establishes, rather than adding another prop to
  // TaskBoard's already-long BoardView call site.
  const isDesktop = useMediaQuery('(min-width: 900px)')

  // Swipe left/right on mobile to step between Pins/Projects/Inbox — same
  // gesture (touchstart/touchend only, no running touchmove tracking, no
  // preventDefault, horizontal-dominance + minimum-distance check) as
  // TaskBoard.jsx's own handleDaySwipe/handleMonthSwipe, deliberately a
  // separate small copy rather than a shared hook, matching that file's
  // own reasoning for not sharing one between Day and Month either. Now a
  // clamped index step across three sections rather than a direct
  // two-way toggle, once Projects made it three.
  const swipeStart = useRef(null)
  const SWIPE_MIN_DISTANCE = 60

  function handleSwipeStart(e) {
    if (isDesktop) return
    const t = e.touches[0]
    swipeStart.current = { x: t.clientX, y: t.clientY }
  }

  function handleSwipeEnd(e) {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return
    const index = SECTIONS.indexOf(section)
    const nextIndex = dx > 0 ? index - 1 : index + 1
    if (nextIndex < 0 || nextIndex >= SECTIONS.length) return
    setSection(SECTIONS[nextIndex])
  }

  return (
    <>
      <PeriodTabs className="board-section-tabs">
        <PeriodTab active={section === 'pins'} onClick={() => setSection('pins')}>
          <Pin size={14} className="mr-1 inline align-[-2px]" /> Pins
        </PeriodTab>
        <PeriodTab active={section === 'projects'} onClick={() => setSection('projects')}>
          <Milestone size={14} className="mr-1 inline align-[-2px]" /> Projects
        </PeriodTab>
        <PeriodTab active={section === 'inbox'} onClick={() => setSection('inbox')}>
          <InboxIcon size={14} className="mr-1 inline align-[-2px]" /> Inbox{hasUnseenInbox && ' •'}
        </PeriodTab>
      </PeriodTabs>

      <div onTouchStart={handleSwipeStart} onTouchEnd={handleSwipeEnd}>
        {section === 'pins' && <CorkBoardView me={me} memberName={memberName} tasks={tasks} focusPinRequest={focusPinRequest} />}
        {section === 'projects' && <CorkBoardView me={me} memberName={memberName} tasks={tasks} mode="projects" />}
        {section === 'inbox' && (
          <InboxView
            tasks={tasks}
            meId={meId}
            memberName={memberName}
            onSelectTask={onSelectTask}
            onUpdate={onUpdate}
            lastViewedAt={lastViewedAt}
          />
        )}
      </div>
    </>
  )
}
