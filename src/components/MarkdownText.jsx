import ReactMarkdown from 'react-markdown'

// A small set of element overrides so pasted markdown (headings, bold,
// bullet/numbered lists) reads correctly against Tandem's own theme
// tokens and compact card spacing — react-markdown renders to a real
// element tree (no dangerouslySetInnerHTML), so no separate sanitizer is
// needed. Only staff.job_description uses this today (StaffProfileForm.jsx
// is member-only, so there's no untrusted-author concern either way).
const COMPONENTS = {
  h1: (props) => <h3 className="mt-3 mb-1 text-[15px] font-semibold text-text-h first:mt-0" {...props} />,
  h2: (props) => <h3 className="mt-3 mb-1 text-[15px] font-semibold text-text-h first:mt-0" {...props} />,
  h3: (props) => <h4 className="mt-2 mb-1 text-sm font-semibold text-text-h first:mt-0" {...props} />,
  p: (props) => <p className="my-1 text-sm text-text-h" {...props} />,
  ul: (props) => <ul className="my-1 list-disc space-y-0.5 pl-5 text-sm text-text-h" {...props} />,
  ol: (props) => <ol className="my-1 list-decimal space-y-0.5 pl-5 text-sm text-text-h" {...props} />,
  li: (props) => <li className="text-sm text-text-h" {...props} />,
  strong: (props) => <strong className="font-semibold text-text-h" {...props} />,
  a: (props) => <a className="underline" target="_blank" rel="noreferrer" {...props} />,
}

export default function MarkdownText({ text }) {
  return <ReactMarkdown components={COMPONENTS}>{text}</ReactMarkdown>
}
