import { useState } from 'react'
import CorkBoardView from './CorkBoardView'
import InboxView from './InboxView'
import { PeriodTabs, PeriodTab } from './PeriodTabs'

// Cork Board + Inbox, merged into one nav destination (Proposal A) — a
// navigation-level grouping only. Neither screen's own data/Realtime/CRUD
// logic changes; this just decides which of the two already-existing,
// unmodified components renders, the same way TaskBoard.jsx's own
// activeTab switch already does for every other tab.
export default function BoardView({ me, memberName, tasks, meId, onSelectTask, onUpdate, lastViewedAt, hasUnseenInbox }) {
  // Inbox carried the nav's unread badge before this merge — opening
  // Board should land on whatever the badge was pointing at, not bury it
  // behind Pins by default.
  const [section, setSection] = useState(hasUnseenInbox ? 'inbox' : 'pins')

  return (
    <>
      <PeriodTabs className="board-section-tabs">
        <PeriodTab active={section === 'pins'} onClick={() => setSection('pins')}>
          📌 Pins
        </PeriodTab>
        <PeriodTab active={section === 'inbox'} onClick={() => setSection('inbox')}>
          📥 Inbox{hasUnseenInbox && ' •'}
        </PeriodTab>
      </PeriodTabs>

      {section === 'pins' ? (
        <CorkBoardView me={me} memberName={memberName} />
      ) : (
        <InboxView
          tasks={tasks}
          meId={meId}
          memberName={memberName}
          onSelectTask={onSelectTask}
          onUpdate={onUpdate}
          lastViewedAt={lastViewedAt}
        />
      )}
    </>
  )
}
