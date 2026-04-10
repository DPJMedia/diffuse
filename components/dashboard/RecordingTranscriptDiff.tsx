'use client'

import { diffWordsWithSpace, type Change } from 'diff'
import { highlightSearch } from '@/lib/utils/transcriptSearchHighlight'

type InlineDiffPart = { text: string; type: 'same' | 'added' | 'removed' }

function buildInlineDiffParts(original: string, current: string): InlineDiffPart[] {
  const changes = diffWordsWithSpace(original, current) as Change[]
  const parts: InlineDiffPart[] = []

  const pushPart = (type: InlineDiffPart['type'], text: string) => {
    if (!text) return
    const last = parts[parts.length - 1]
    if (last && last.type === type) last.text += text
    else parts.push({ type, text })
  }

  const commonPrefixLen = (a: string, b: string) => {
    const n = Math.min(a.length, b.length)
    let k = 0
    while (k < n && a[k] === b[k]) k++
    return k
  }

  const commonSuffixLen = (a: string, b: string) => {
    const n = Math.min(a.length, b.length)
    let k = 0
    while (k < n && a[a.length - 1 - k] === b[b.length - 1 - k]) k++
    return k
  }

  const buffer: Change[] = []

  const flushBuffer = () => {
    if (buffer.length === 0) return
    const hasAdded = buffer.some((c) => !!c.added)
    const hasRemoved = buffer.some((c) => !!c.removed)

    if (hasAdded && hasRemoved) {
      const originalSeg = buffer.filter((c) => !c.added).map((c) => c.value ?? '').join('')
      const currentSeg = buffer.filter((c) => !c.removed).map((c) => c.value ?? '').join('')
      const prefix = commonPrefixLen(originalSeg, currentSeg)
      const aRest = originalSeg.slice(prefix)
      const bRest = currentSeg.slice(prefix)
      let suffix = commonSuffixLen(aRest, bRest)
      suffix = Math.min(suffix, aRest.length, bRest.length)
      const prefixStr = originalSeg.slice(0, prefix)
      const suffixStr = suffix > 0 ? originalSeg.slice(originalSeg.length - suffix) : ''
      const removedMid = originalSeg.slice(prefix, originalSeg.length - suffix)
      const addedMid = currentSeg.slice(prefix, currentSeg.length - suffix)
      pushPart('same', prefixStr)
      pushPart('removed', removedMid)
      pushPart('added', addedMid)
      pushPart('same', suffixStr)
    } else {
      for (const c of buffer) {
        const type: InlineDiffPart['type'] = c.added ? 'added' : c.removed ? 'removed' : 'same'
        pushPart(type, c.value ?? '')
      }
    }
    buffer.length = 0
  }

  for (const c of changes) {
    const value = c.value ?? ''
    if (value.includes('\n\n')) {
      const lines = value.split(/(\n\n)/)
      for (const line of lines) {
        if (line === '\n\n') {
          flushBuffer()
          pushPart('same', line)
        } else if (line) {
          buffer.push({ ...c, value: line })
        }
      }
    } else {
      buffer.push(c)
    }
  }
  flushBuffer()
  return parts
}

type Props = {
  original: string
  current: string
  transcriptSearchQuery: string
  activeMode: string
  transcriptSearchCurrentMatch: number
}

export default function RecordingTranscriptDiff({
  original,
  current,
  transcriptSearchQuery,
  activeMode,
  transcriptSearchCurrentMatch,
}: Props) {
  return (
    <div className="space-y-2 text-body-sm">
      {buildInlineDiffParts(original, current).map((part, i) => {
        if (part.type === 'same') {
          return (
            <span key={i} className="text-secondary-white whitespace-pre-wrap">
              {transcriptSearchQuery && activeMode === 'search'
                ? highlightSearch(part.text, transcriptSearchQuery, transcriptSearchCurrentMatch)
                : part.text}
            </span>
          )
        } else if (part.type === 'removed') {
          return (
            <del key={i} className="bg-red-500/20 text-red-300 whitespace-pre-wrap">
              {part.text}
            </del>
          )
        } else {
          return (
            <ins key={i} className="bg-green-500/20 text-green-300 no-underline whitespace-pre-wrap">
              {part.text}
            </ins>
          )
        }
      })}
    </div>
  )
}
