'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'
import { howItWorks } from '@/lib/content/diffuse'

// Step copy lives in lib/content/diffuse.ts (shared with the MCP server and llms.txt).
// Icons are presentational and stay here, matched to the steps by index.
const stepIcons = [
  // Capture
  <svg key="capture" className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
  </svg>,
  // Transcribe and review
  <svg key="transcribe" className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>,
  // Draft with AI
  <svg key="draft" className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>,
  // Verify and publish
  <svg key="verify" className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>,
]

const steps = howItWorks.map((step, i) => ({
  number: String(i + 1).padStart(2, '0'),
  title: step.title,
  description: step.body,
  icon: stepIcons[i],
}))

export default function HowItWorks() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.1,
      },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.8,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  }

  return (
    <section id="how-it-works" ref={ref} className="relative py-16 sm:py-20 md:py-24 scroll-mt-20">
      <div className="container-padding">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="max-w-6xl mx-auto"
        >
          {/* Section Header */}
          <motion.div variants={itemVariants} className="text-center mb-12 md:mb-16 px-4">
            <span className="text-cosmic-orange text-body-sm uppercase tracking-wider font-semibold mb-3 block">
              How it works
            </span>
            <h2 className="text-display-sm font-bold mb-4">
              From raw material to <span className="text-secondary-white">verified story</span>, in four steps
            </h2>
            <p className="text-body-lg text-medium-gray max-w-2xl mx-auto">
              Capture the source, review the transcript, draft with AI, then verify and publish. The recordings and documents stay with the story.
            </p>
          </motion.div>

          {/* Steps Grid */}
          <motion.div variants={itemVariants} className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((step) => (
              <motion.div
                key={step.number}
                variants={itemVariants}
                className="glass-container p-6"
              >
                {/* Step number */}
                <div className="text-cosmic-orange/30 text-4xl font-bold mb-4">
                  {step.number}
                </div>

                {/* Icon */}
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cosmic-orange/20 to-rich-orange/20 flex items-center justify-center text-cosmic-orange mb-4">
                  {step.icon}
                </div>

                {/* Title */}
                <h3 className="text-heading-lg font-bold text-secondary-white mb-2">
                  {step.title}
                </h3>

                {/* Description */}
                <p className="text-body-md text-medium-gray leading-relaxed">
                  {step.description}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

