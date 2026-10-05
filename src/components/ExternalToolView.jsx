import { useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import Modal from './Modal'
import LoadingText from './LoadingText'

// An outside tool shown full screen inside Tandem, so opening it never takes
// someone out of the app. Closing returns to wherever it was opened from.
//
// "Open in browser" is always visible: a frame cannot report that a page
// refused to load, and a phone may handle the tool better in its own tab.
//
// The sandbox lists exactly what a typical web tool needs and nothing more:
// scripts, its own storage and requests (allow-same-origin), forms, downloads
// (exports), dialogs, and links that open in a new tab. No referrer is sent,
// so the tool does not learn Tandem's address.
export default function ExternalToolView({ tool, onClose }) {
  const [loaded, setLoaded] = useState(false)

  return (
    <Modal onClose={onClose}>
      <div
        className="fixed inset-0 z-[101] flex flex-col bg-card-bg"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-sm border border-border bg-pill-bg px-3 text-sm text-text-h [font-family:inherit]"
          >
            <X size={16} aria-hidden="true" />
            Close
          </button>
          <h2 className="m-0 line-clamp-2 min-w-0 flex-1 text-[14px] leading-tight font-semibold text-text-h">{tool.title}</h2>
          <a
            href={tool.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-10 flex-none items-center gap-1.5 rounded-sm px-2 text-xs text-accent-text underline"
          >
            Open in browser
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
        <div className="relative min-h-0 flex-1">
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <LoadingText>Opening {tool.title}…</LoadingText>
            </div>
          )}
          <iframe
            title={tool.title}
            src={tool.url}
            onLoad={() => setLoaded(true)}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox"
            className="block h-full w-full border-0 bg-card-bg"
          />
        </div>
      </div>
    </Modal>
  )
}
