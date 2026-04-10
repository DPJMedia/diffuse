import React from 'react'

export function highlightSearch(text: string, query: string, currentMatch: number): React.ReactNode[] {
  if (!query) return [text]
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const matches = Array.from(text.matchAll(regex))
  if (matches.length === 0) return [text]
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let count = 0
  for (const match of matches) {
    const globalIdx = count
    if (match.index! > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    nodes.push(
      <mark
        key={`match-${globalIdx}`}
        data-search-match={globalIdx}
        className={`rounded px-0.5 ${globalIdx === currentMatch ? 'bg-cosmic-orange text-black' : 'bg-cosmic-orange/30 text-secondary-white'}`}
      >
        {match[0]}
      </mark>
    )
    count++
    lastIndex = match.index! + match[0].length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes.length > 0 ? nodes : [text]
}
