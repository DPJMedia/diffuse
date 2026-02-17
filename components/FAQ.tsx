'use client'

import { motion, useInView, AnimatePresence } from 'framer-motion'
import { useRef, useState } from 'react'

const faqs = [
  {
    question: 'What is Diffuse.AI?',
    answer: 'Diffuse.AI is an AI-powered tool that transforms audio recordings into publication-ready news articles. Record or upload audio from meetings, interviews, or events, and our AI generates structured articles with headlines, excerpts, and SEO metadata.',
  },
  {
    question: 'How does Diffuse.AI work?',
    answer: 'Diffuse.AI follows a simple 4-step process: (1) Record - Capture audio in-app or upload existing files, (2) Transcribe - AI automatically transcribes with high accuracy, (3) Generate - Create articles from your transcription and other inputs, (4) Publish - Connect to your frontend to auto-publish, or copy and paste. Either way, you\'re live in minutes.',
  },
  {
    question: 'How is Diffuse different from using ChatGPT?',
    answer: 'Diffuse is built for the full workflow: record, transcribe, generate, and publish. Connect to publishing frontends to auto-populate articles—no copy-paste. Designed for small teams at a fraction of the cost, with one smooth workflow instead of juggling multiple tools.',
  },
  {
    question: 'Can I use Diffuse as an individual?',
    answer: 'Absolutely! Diffuse works perfectly for independent journalists, freelancers, and content creators. You don\'t need to create an organization. Just sign up for a free account to get started, or upgrade to a paid plan for more. See Plans in the dashboard for tier options.',
  },
  {
    question: 'What file types can I upload?',
    answer: 'Diffuse supports audio files (MP3, WAV, M4A), documents (PDF, DOCX, TXT), and images (JPG, PNG). You can combine multiple input types in a single project to generate comprehensive articles.',
  },
  {
    question: 'What\'s included in the free tier?',
    answer: 'The free tier includes full AI article generation, audio transcription, and file uploads. No credit card required. It\'s perfect for trying out Diffuse. Paid tiers offer more—see Plans in the dashboard for details.',
  },
  {
    question: 'How accurate is the AI-generated content?',
    answer: 'Diffuse.AI generates publication-ready articles using advanced AI. The output includes headlines, subtitles, excerpts, and full article content. We always recommend reviewing and editing before publishing to add your own voice and verify accuracy.',
  },
  {
    question: 'Can I edit the generated articles?',
    answer: 'Yes! All generated content is fully editable. You can modify the transcription before generating, and then edit all parts of the output article including title, subtitle, excerpt, content, and SEO fields.',
  },
  {
    question: 'How does team collaboration work?',
    answer: 'Team plans let you create an organization and invite members with role-based access. Owners have full control, Admins can manage members, Editors can create and modify content, and Viewers have read-only access. Teams join via invite codes.',
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
            <span className="text-cosmic-orange text-xs sm:text-sm md:text-caption uppercase tracking-wider font-semibold mb-3 block">
              FAQ
            </span>
            <h2 className="text-2xl sm:text-3xl md:text-heading-xl lg:text-display-sm font-bold mb-4">
              Frequently Asked <span className="gradient-text">Questions</span>
            </h2>
            <p className="text-base sm:text-lg md:text-body-md text-medium-gray max-w-2xl mx-auto">
              Everything you need to know about Diffuse.AI
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
                  <span className="text-base md:text-lg font-medium text-secondary-white pr-4">
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
                      <div className="px-6 pb-5 text-medium-gray leading-relaxed border-t border-white/10 pt-4">
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

