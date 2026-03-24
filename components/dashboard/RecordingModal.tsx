'use client'

import RecordingSessionPanel, { type RecordingSessionPanelProps } from './RecordingSessionPanel'

export type RecordingModalProps = Omit<RecordingSessionPanelProps, 'variant' | 'onBack'>

export default function RecordingModal(props: RecordingModalProps) {
  return <RecordingSessionPanel variant="modal" {...props} />
}
