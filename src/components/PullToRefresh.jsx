import { useRef, useState } from 'react'

const THRESHOLD = 70

// Standalone "Add to Home Screen" apps have no browser chrome — no
// reload button, no native pull-to-refresh the way a browser tab or
// Android Chrome's installed-PWA mode sometimes provides — so this is
// implemented by hand rather than relying on anything the OS gives us.
// Only engages when the page is already scrolled to the very top, so it
// doesn't fight with normal scrolling through the task list.
export default function PullToRefresh({ onRefresh, children }) {
  const [pullY, setPullY] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const touchStartY = useRef(null)

  function handleTouchStart(e) {
    touchStartY.current = window.scrollY === 0 ? e.touches[0].clientY : null
  }

  function handleTouchMove(e) {
    if (touchStartY.current === null || refreshing) return
    // Scrolled away from the top mid-gesture — stop tracking, but don't
    // reset touchStartY: a little jitter right at the start of a touch
    // (a pixel or two of noise before the deliberate pull begins) used to
    // permanently kill tracking for the rest of that touch here, which is
    // exactly why this felt like it "didn't work."
    if (window.scrollY > 0) {
      setPullY(0)
      return
    }
    const delta = e.touches[0].clientY - touchStartY.current
    setPullY(delta > 0 ? Math.min(delta * 0.5, 90) : 0)
  }

  async function handleTouchEnd() {
    if (pullY > THRESHOLD) {
      setRefreshing(true)
      setPullY(THRESHOLD)
      await onRefresh()
      setRefreshing(false)
    }
    setPullY(0)
    touchStartY.current = null
  }

  const indicatorHeight = refreshing ? THRESHOLD : pullY
  const ready = refreshing || pullY > THRESHOLD

  return (
    <div onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div className="pull-to-refresh-indicator" style={{ height: indicatorHeight }}>
        {indicatorHeight > 0 && (
          <div className={`pull-to-refresh-content${ready ? ' pull-to-refresh-ready' : ''}`}>
            <span className={`pull-to-refresh-spinner${refreshing ? ' pull-to-refresh-spinning' : ''}`}>↻</span>
            <span className="pull-to-refresh-label">
              {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}
            </span>
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
