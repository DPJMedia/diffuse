/**
 * Display / export label for a diarization speaker id (A, B, …), using saved map and auto-detected names.
 */
export function getSpeakerLabel(
  speaker: string,
  speakerMap?: Record<string, { name: string; position?: string }> | null,
  detectedNames?: Record<string, string> | null
): string {
  if (speakerMap && speakerMap[speaker]) {
    const info = speakerMap[speaker]
    return info.position ? `${info.name} (${info.position})` : info.name
  }

  if (detectedNames && detectedNames[speaker]) {
    return detectedNames[speaker]
  }

  const match = speaker.match(/^([A-Z])$/)
  if (match) {
    const speakerNumber = match[1].charCodeAt(0) - 'A'.charCodeAt(0) + 1
    return `Speaker ${speakerNumber}`
  }

  return speaker
}

/** Plain text: one block per utterance, “Name: text”, for clipboard export. */
export function buildUtteranceTranscriptCopy(
  utterances: Array<{ speaker: string; text: string }> | null | undefined,
  speakerMap: Record<string, { name: string; position?: string }> | null | undefined,
  detectedNames: Record<string, string> | null | undefined,
  fallbackTranscription: string | null | undefined
): string {
  const rows = utterances?.filter((u) => u.text?.trim()) ?? []
  if (rows.length === 0) {
    return (fallbackTranscription ?? '').trim()
  }
  return rows
    .map((u) => `${getSpeakerLabel(u.speaker, speakerMap, detectedNames)}: ${u.text.trim()}`)
    .join('\n\n')
}
