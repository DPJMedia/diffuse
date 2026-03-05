'use client'

import { motion, useInView, AnimatePresence } from 'framer-motion'
import { useRef, useState } from 'react'

const faqs = [
  {
    question: 'What is Diffuse?',
    answer: 'Diffuse turns recordings, documents, and web pages into publication-ready articles and ads in one place. You get transcription with speaker names, the ability to mix multiple sources per project, and optional publishing integrations so you can go from record to live article without switching tools.',
  },
  {
    question: 'How does the recording to publish process work?',
    answer: 'Record in the app or upload audio, add documents or web links if you want. We transcribe and optionally identify speakers so you can name them. Edit the transcript, then click Generate to get an article or ad. Connect your site to auto-fill fields, or copy and paste. Same flow for solo use or teams.',
  },
  {
    question: 'What can I use as input?',
    answer: 'Audio (record or upload MP3, WAV, M4A), documents (PDF, DOCX, TXT), images, and URLs for web scraping. You can combine several inputs in one project so one piece can pull from a meeting, a press release, and a scraped page.',
  },
  {
    question: 'Can I edit the transcription and the generated content?',
    answer: 'Yes. You can fix the transcript and speaker names before generating. Every output is fully editable: headline, excerpt, body, SEO fields. You can also re-edit and create new versions so the tool adapts to your edits instead of locking you in.',
  },
  {
    question: 'Who is Diffuse for?',
    answer: 'Freelancers, small newsrooms, and content teams who need to turn meetings, interviews, or documents into articles or ads quickly. Free tier gets you started; paid plans add more projects and team features. No organization required to try it.',
  },
  {
    question: 'How is this different from using ChatGPT or other AI writing tools?',
    answer: 'Diffuse is built for the full path from source to published piece. You get recording and upload, transcription with speaker ID, multi-input projects, and article or ad generation in one workflow. If you connect a publishing frontend, articles can auto-populate there so you are not copy-pasting. It is one product for the job, not a generic chatbot plus manual steps.',
  },
]

export default function FAQ() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
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
    <section id="faq" ref={ref} className="relative py-16 sm:py-20 md:py-24 scroll-mt-20">
      <div className="container-padding">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="max-w-4xl mx-auto"
        >
          {/* Section Header */}
          <motion.div variants={itemVariants} className="text-center mb-12 px-4">
            <span className="text-cosmic-orange text-body-sm uppercase tracking-wider font-semibold mb-3 block">
              FAQ
            </span>
            <h2 className="text-display-sm font-bold mb-4">
              Frequently Asked <span className="text-secondary-white">Questions</span>
            </h2>
            <p className="text-body-lg text-medium-gray max-w-2xl mx-auto">
              What you need to know before you start.
            </p>
          </motion.div>

          {/* FAQ Items */}
          <motion.div variants={itemVariants} className="space-y-4">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className="glass-container overflow-hidden"
              >
                <button
                  onClick={() => setOpenIndex(openIndex === index ? null : index)}
                  className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
                >
                  <span className="text-body-lg font-medium text-secondary-white pr-4">
                    {faq.question}
                  </span>
                  <motion.div
                    animate={{ rotate: openIndex === index ? 180 : 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex-shrink-0"
                  >
                    <svg className="w-5 h-5 text-cosmic-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </motion.div>
                </button>
                
                <AnimatePresence>
                  {openIndex === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="px-6 pb-5 text-body-md text-medium-gray leading-relaxed border-t border-white/10 pt-4">
                        {faq.answer}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

