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
              <div className="grid lg:grid-cols-2 gap-8 md:gap-12 items-start">
                {/* Left Content - sets the height for the row */}
                <div>
                  <div className="inline-block px-3 py-1 bg-[#3391af]/20 text-[#3391af] text-xs font-semibold uppercase tracking-wider rounded-full mb-4">
                    Live Example
                  </div>
                  <h3 className="text-2xl sm:text-3xl md:text-heading-xl font-bold mb-4 md:mb-6">
                    <span className="text-[#dbdbdb]">Spring-Ford</span> <span className="text-[#3391af]">Press</span>
                  </h3>
                  <p className="text-sm text-[#3391af] font-medium mb-3">
                    See how diffuse.ai connects to publishing frontends
                  </p>
                  <p className="text-base sm:text-lg md:text-body-md text-secondary-white mb-6 leading-relaxed">
                    Connect your diffuse.ai account to frontends like Spring-Ford Press. Generated articles auto-populate fields—no copy-paste. Record, generate, and publish within minutes of a meeting.
                  </p>

                  <div className="space-y-4">
                    {[
                      'Connect diffuse.ai to your publishing frontend',
                      'Auto-populate article fields—no copy-paste',
                      'Record, generate, and publish within minutes',
                    ].map((feature, index) => (
                      <div key={index} className="flex items-start gap-3">
                        <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#3391af]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-[#3391af]">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                        <span className="text-sm sm:text-base md:text-body-md text-secondary-white">{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right Visual - matches left height, image crops to fit */}
                <div className="relative w-full min-h-0 self-stretch">
                  <a 
                    href="https://springford.press" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="absolute inset-0 flex flex-col overflow-hidden rounded-glass group transition-transform duration-300 hover:scale-[1.02]"
                  >
                    <div className="flex-shrink-0 bg-[#3391af]/90 group-hover:bg-[#57959f] px-4 py-3 flex items-center justify-center transition-colors duration-300">
                      <span className="text-sm sm:text-base md:text-body-sm font-bold text-white uppercase tracking-wider">
                        See It In Action
                      </span>
                    </div>

                    <div className="glass-container flex-1 min-h-0 flex items-center justify-center relative overflow-hidden rounded-none border-t-0 border-b-0 border-x-0 w-full">
                      <Image
                        src="/sfpthumb.png"
                        alt="Spring-Ford Press"
                        fill
                        className="object-cover object-top"
                        sizes="(max-width: 768px) 100vw, 50vw"
                      />
                    </div>

                    <div className="flex-shrink-0 bg-[#3391af]/90 group-hover:bg-[#57959f] px-4 py-3 flex items-center justify-center gap-2 transition-colors duration-300">
                      <span className="text-sm sm:text-base md:text-body-md font-bold text-white">Visit springford.press</span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </div>
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
