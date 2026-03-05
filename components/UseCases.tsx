'use client'

import { motion, useInView } from 'framer-motion'
import Image from 'next/image'
import { useRef } from 'react'

export default function UseCases() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section id="use-cases" ref={ref} className="relative py-16 sm:py-20 md:py-24 bg-dark-gray/30 scroll-mt-20">
      <div className="container-padding">
        <div className="max-w-6xl mx-auto">
          {/* Spring-Ford Press Section */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="glass-container p-6 sm:p-8 md:p-10 lg:p-14 overflow-hidden">
              <div className="grid lg:grid-cols-[1.35fr_0.65fr] gap-4 md:gap-6 lg:gap-8 items-stretch">
                {/* Left Content - sets the row height */}
                <div>
                  <div className="inline-block px-3 py-1 bg-[#3391af]/20 text-[#3391af] text-xs font-semibold uppercase tracking-wider rounded-full mb-4">
                    Live Example
                  </div>
                  <h3 className="text-2xl sm:text-3xl md:text-heading-xl font-bold mb-4 md:mb-6">
                    <span className="text-[#dbdbdb]">Spring-Ford</span> <span className="text-[#3391af]">Press</span>
                  </h3>
                  <p className="text-body-md text-secondary-white mb-4 leading-relaxed">
                    Spring-Ford Press is a local news site covering the Spring-Ford community in Pennsylvania. It serves as the first live newsroom built on Diffuse, demonstrating how AI-assisted workflows can help small teams produce consistent local coverage.
                  </p>
                  <p className="text-body-md text-secondary-white mb-4 leading-relaxed">
                    Diffuse captures municipal meetings, generates transcripts, and produces structured draft articles that flow directly into the CMS, with headlines, bylines, and body text ready for editorial review and scheduling.
                  </p>
                  <p className="text-body-md text-secondary-white mb-6 leading-relaxed">
                    Spring-Ford Press isn&apos;t a demo. It&apos;s a working newsroom powered by Diffuse in production.
                  </p>
                  <a
                    href="https://springford.press"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#3391af] hover:bg-[#57959f] text-white font-semibold rounded-lg transition-colors duration-200"
                  >
                    Visit site
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </a>
                </div>

                {/* Right - image only, height matches left content; no container; hidden on mobile */}
                <div className="hidden lg:block relative aspect-[3/4] lg:aspect-auto">
                  <div className="absolute inset-0 flex justify-end">
                    <div className="relative h-full w-full max-w-sm ml-auto">
                      <Image
                        src="/mockupphoner.png"
                        alt="Spring-Ford Press"
                        fill
                        className="object-contain object-right"
                        sizes="(max-width: 1024px) 100vw, 384px"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
