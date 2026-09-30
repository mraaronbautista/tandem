import { useEffect, useState } from 'react'
import { downloadAttachment } from '../lib/attachments'

// How long to keep a just-superseded blob URL alive after this component
// stops using it. Revoking synchronously on unmount/url-change raced with
// a file link opened target="_blank" in a new tab — if that tab hadn't
// finished resolving the blob: URL yet (a realtime update or a parent
// re-render swapping this slot's url in that window), the revoke could
// land first and the new tab's load would fail with no retry. A held-open
// grace period is the standard mitigation; 30s is comfortably longer than
// any realistic tab-open-to-resource-load gap.
const REVOKE_GRACE_MS = 30000

// Download through the signed-in Storage client. Blob URLs aren't public
// Storage links and are revoked (after the grace period above) when the
// attachment leaves the screen.
export default function PrivateAttachment({ url, image = false, children, ...props }) {
  const [file, setFile] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    let objectUrl
    setFile(null)
    setFailed(false)
    downloadAttachment(url).then((blob) => {
      if (cancelled) return
      objectUrl = URL.createObjectURL(blob)
      setFile({ source: url, objectUrl })
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      if (objectUrl) {
        const toRevoke = objectUrl
        setTimeout(() => URL.revokeObjectURL(toRevoke), REVOKE_GRACE_MS)
      }
    }
  }, [url])
  if (!file || file.source !== url) {
    // {...props} here too — className/target/rel/etc. are meant to style
    // this element regardless of which of the three states (loading,
    // failed, loaded) is currently rendering, same as the loaded branches
    // below already do.
    return (
      <span role="status" {...props}>
        {failed ? 'Attachment unavailable or access denied' : 'Loading attachment…'}
      </span>
    )
  }
  return image
    ? <img {...props} src={file.objectUrl} />
    : <a {...props} href={file.objectUrl}>{children}</a>
}
