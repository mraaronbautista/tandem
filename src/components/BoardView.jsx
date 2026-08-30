import { useState } from 'react'
import CorkBoardView from './CorkBoardView'
import InboxView from './InboxView'

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
      <div className="period-tabs board-section-tabs">
        <button
          type="button"
          className={`period-tab${section === 'pins' ? ' period-tab-active' : ''}`}
          onClick={() => setSection('pins')}
        >
          📌 Pins
        </button>
        <button
          type="button"
          className={`period-tab${section === 'inbox' ? ' period-tab-active' : ''}`}
          onClick={() => setSection('inbox')}
        >
          📥 Inbox{hasUnseenInbox && ' •'}
        </button>
      </div>

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
