'use client'

import { diffWordsWithSpace, type Change } from 'diff'

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
    const isSame = !c.added && !c.removed
    const isWhitespaceOnlySame = isSame && !/\S/.test(value)

    if (isWhitespaceOnlySame) {
      buffer.push(c)
      continue
    }

    if (isSame) {
      flushBuffer()
      pushPart('same', value)
      continue
    }

    buffer.push(c)
  }

  flushBuffer()
  return parts
}

export default function InlineDiff({
  original,
  current,
}: {
  original: string
  current: string
}) {
  const result = buildInlineDiffParts(original, current)

  return (
    <span className="whitespace-pre-wrap">
      {result.map((item, idx) => {
        if (item.type === 'same') return <span key={idx}>{item.text}</span>
        if (item.type === 'added')
          return (
            <span key={idx} className="text-cosmic-orange">
              {item.text}
            </span>
          )
        return (
          <span key={idx} className="text-medium-gray line-through">
            {item.text}
          </span>
        )
      })}
    </span>
  )
}
