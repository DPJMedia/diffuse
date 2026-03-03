#!/usr/bin/env node

/**
 * Test script to check what AssemblyAI returns for your 88-minute file
 * 
 * Usage:
 * 1. Get the signed URL from Supabase for your 88-minute recording
 * 2. Run: node test-assemblyai.js "YOUR_SIGNED_URL_HERE"
 */

const ASSEMBLYAI_API_KEY = '195bb5a691ea406eba83b0ca21c47d2b'

async function testTranscription(audioUrl) {
  console.log('🎙️  Testing AssemblyAI Speaker Diarization')
  console.log('Audio URL:', audioUrl.substring(0, 100) + '...')
  console.log('')

  try {
    // Submit transcription
    console.log('📤 Submitting transcription request...')
    const submitResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'authorization': ASSEMBLYAI_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        speaker_labels: true,
        // Try without speakers_expected first
      })
    })

    const submitData = await submitResponse.json()
    console.log('✅ Submitted. Transcript ID:', submitData.id)
    console.log('')

    // Poll for completion
    console.log('⏳ Waiting for transcription to complete...')
    let transcript = submitData
    let attempts = 0
    const maxAttempts = 200 // ~10 minutes max wait

    while (transcript.status !== 'completed' && transcript.status !== 'error' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 3000)) // Wait 3 seconds
      
      const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${submitData.id}`, {
        headers: {
          'authorization': ASSEMBLYAI_API_KEY,
        }
      })
      
      transcript = await pollResponse.json()
      attempts++
      
      if (attempts % 10 === 0) {
        console.log(`  Still processing... (${attempts * 3}s elapsed)`)
      }
    }

    if (transcript.status === 'error') {
      console.error('❌ Transcription failed:', transcript.error)
      return
    }

    if (transcript.status !== 'completed') {
      console.error('❌ Timeout waiting for transcription')
      return
    }

    console.log('✅ Transcription complete!')
    console.log('')
    
    // Analysis
    console.log('📊 RESULTS:')
    console.log('─────────────────────────────────────────')
    console.log('Status:', transcript.status)
    console.log('Audio duration (seconds):', transcript.audio_duration)
    console.log('Audio duration (minutes):', (transcript.audio_duration / 60).toFixed(2))
    console.log('Text length (characters):', transcript.text?.length || 0)
    console.log('Has utterances:', !!transcript.utterances)
    console.log('Utterances count:', transcript.utterances?.length || 0)
    console.log('')

    if (transcript.utterances && transcript.utterances.length > 0) {
      // Count unique speakers
      const speakers = new Set(transcript.utterances.map(u => u.speaker))
      console.log('🎤 SPEAKER ANALYSIS:')
      console.log('─────────────────────────────────────────')
      console.log('Unique speakers:', Array.from(speakers).sort().join(', '))
      console.log('Total unique speakers:', speakers.size)
      console.log('')

      // Show first 5 and last 5 utterances
      console.log('📝 FIRST 5 UTTERANCES:')
      console.log('─────────────────────────────────────────')
      transcript.utterances.slice(0, 5).forEach((u, i) => {
        const startSec = (u.start / 1000).toFixed(1)
        const endSec = (u.end / 1000).toFixed(1)
        const duration = ((u.end - u.start) / 1000).toFixed(1)
        console.log(`${i + 1}. Speaker ${u.speaker} (${startSec}s - ${endSec}s, duration: ${duration}s)`)
        console.log(`   "${u.text.substring(0, 80)}..."`)
        console.log('')
      })

      if (transcript.utterances.length > 5) {
        console.log('📝 LAST 5 UTTERANCES:')
        console.log('─────────────────────────────────────────')
        transcript.utterances.slice(-5).forEach((u, i) => {
          const startSec = (u.start / 1000).toFixed(1)
          const endSec = (u.end / 1000).toFixed(1)
          const duration = ((u.end - u.start) / 1000).toFixed(1)
          console.log(`${transcript.utterances.length - 4 + i}. Speaker ${u.speaker} (${startSec}s - ${endSec}s, duration: ${duration}s)`)
          console.log(`   "${u.text.substring(0, 80)}..."`)
          console.log('')
        })
      }

      // Check for single giant utterance
      const isSingleGiant = transcript.utterances.length === 1 && 
                           (transcript.utterances[0].end / 1000) > (transcript.audio_duration * 0.95)
      
      if (isSingleGiant) {
        console.log('⚠️  WARNING: FAILED DIARIZATION DETECTED!')
        console.log('─────────────────────────────────────────')
        console.log('Single utterance spans', ((transcript.utterances[0].end / 1000) / 60).toFixed(2), 'minutes')
        console.log('This means speaker diarization failed.')
        console.log('The entire recording was treated as one continuous speech.')
        console.log('')
      }
    } else {
      console.log('❌ No utterances returned (speaker diarization completely failed)')
      console.log('Plain text transcript length:', transcript.text?.length || 0)
    }

    console.log('')
    console.log('💡 To see the full JSON response, add this at the end:')
    console.log('   console.log(JSON.stringify(transcript, null, 2))')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

// Get audio URL from command line
const audioUrl = process.argv[2]

if (!audioUrl) {
  console.error('❌ Please provide an audio URL')
  console.error('Usage: node test-assemblyai.js "YOUR_AUDIO_URL"')
  process.exit(1)
}

testTranscription(audioUrl)
