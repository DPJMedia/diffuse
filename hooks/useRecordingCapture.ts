'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Browser MediaRecorder capture — same behavior as the recordings page modal.
 */
export function useRecordingCapture() {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordingStartTimeRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream

    let mimeType = 'audio/webm'
    if (typeof MediaRecorder !== 'undefined') {
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus'
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm'
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4'
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        mimeType = 'audio/ogg'
      }
    }

    const mediaRecorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = mediaRecorder
    audioChunksRef.current = []

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data)
      }
    }

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
      setPendingBlob(audioBlob)
    }

    mediaRecorder.start(1000)
    setIsRecording(true)
    setRecordingTime(0)
    setPendingBlob(null)
    recordingStartTimeRef.current = Date.now()

    timerRef.current = setInterval(() => {
      const elapsedMs = Date.now() - recordingStartTimeRef.current
      setRecordingTime(Math.floor(elapsedMs / 1000))
    }, 100)
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
    }
  }, [isRecording])

  const discardRecording = useCallback(() => {
    setPendingBlob(null)
    setRecordingTime(0)
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
    }
  }, [isRecording])

  return {
    isRecording,
    recordingTime,
    pendingBlob,
    startRecording,
    stopRecording,
    discardRecording,
  }
}
