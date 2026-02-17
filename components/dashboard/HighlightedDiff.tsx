'use client'

import { diffChars, diffWords, type Change } from 'diff'

interface HighlightedDiffProps {
  /** Previous value (before re-edit) */
  oldStr: string
  /** Current value (after re-edit) */
  newStr: string
  /** Use word-level diff for long content (better performance). Default true for strings > 500 chars */
  useWords?: boolean
  /** Extra class names for the wrapper */
  className?: string
  /** Render as block (div) or inline (span). Default block for multiline */
  block?: boolean
}

/**
 * Renders a diff: removed text in red with strike-through, added text in green.
 * Uses word-level diff for long content for better performance.
 */
export default function HighlightedDiff({
  oldStr,
  newStr,
  useWords,
  className = '',
  block = false,
}: HighlightedDiffProps) {
  const oldVal = String(oldStr ?? '')
  const newVal = String(newStr ?? '')

  const useWordLevel = useWords ?? newVal.length > 500
  const changes: Change[] = useWordLevel ? diffWords(oldVal, newVal) : diffChars(oldVal, newVal)

  const Wrapper = block ? 'div' : 'span'

  return (
    <Wrapper className={`whitespace-pre-wrap break-words ${className}`}>
      {changes.map((part, i) => {
        if (part.added) {
          return (
            <span key={i} className="text-green-400 bg-green-500/25 rounded-sm px-0.5">
              {part.value}
            </span>
          )
        }
        if (part.removed) {
          return (
            <span key={i} className="text-red-400 line-through decoration-red-400 decoration-2 bg-red-500/25 rounded-sm px-0.5">
              {part.value}
            </span>
          )
        }
        return <span key={i}>{part.value}</span>
      })}
    </Wrapper>
  )
}
