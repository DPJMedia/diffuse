'use client'

import { motion, useInView } from 'framer-motion'
import { useRef, useState } from 'react'

const individualPlans = [
  {
    name: 'Free',
    subtitle1: 'Perfect for trying out Diffuse',
    subtitle2: '3 projects included',
    cta: 'Start Free',
    highlight: false,
  },
  {
    name: 'Pro',
    subtitle1: 'For independent journalists',
    subtitle2: '15 projects included',
    cta: 'Get Pro',
    highlight: true,
    badge: 'Most Popular',
  },
  {
    name: 'Pro Max',
    subtitle1: 'For power users',
    subtitle2: '40 projects included',
    cta: 'Get Pro Max',
    highlight: false,
  },
  {
    name: 'Usage-Based',
    subtitle1: 'Pay only for what you use',
    subtitle2: 'No fixed limit · Pay as you go',
    cta: 'Contact Sales',
    highlight: false,
  },
]

const enterprisePlans = [
  {
    name: 'Team',
    subtitle1: 'For small newsrooms',
    subtitle2: 'Create an organization · Invite team members',
    cta: 'Get Started',
  },
  {
    name: 'Team Max',
    subtitle1: 'For large teams',
    subtitle2: 'Everything in Team · Unlimited members',
    cta: 'Contact Sales',
  },
]

export default function Pricing() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const [showEnterprise, setShowEnterprise] = useState(false)

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
    <section id="pricing" ref={ref} className="relative py-16 sm:py-20 md:py-24 scroll-mt-20 bg-dark-gray/30">
      <div className="container-padding">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="max-w-6xl mx-auto"
        >
          {/* Section Header */}
          <motion.div variants={itemVariants} className="text-center mb-12 px-4">
            <span className={`text-xs sm:text-sm md:text-caption uppercase tracking-wider font-semibold mb-3 block ${showEnterprise ? 'text-accent-purple' : 'text-cosmic-orange'}`}>
              Simple Pricing
            </span>
            <h2 className="text-2xl sm:text-3xl md:text-heading-xl lg:text-display-sm font-bold mb-8">
              Start Free, <span className={showEnterprise ? 'text-accent-purple' : 'gradient-text'}>Scale As You Grow</span>
            </h2>

            {/* Toggle */}
            <div className="inline-flex items-center gap-1 glass-container px-1.5 py-1.5">
              <button
                onClick={() => setShowEnterprise(false)}
                className={`px-4 py-2 rounded-glass text-sm font-medium transition-all ${
                  !showEnterprise
                    ? 'bg-cosmic-orange text-black'
                    : 'text-medium-gray hover:text-secondary-white'
                }`}
              >
                Individual
              </button>
              <button
                onClick={() => setShowEnterprise(true)}
                className={`px-4 py-2 rounded-glass text-sm font-medium transition-all ${
                  showEnterprise
                    ? 'bg-accent-purple text-black'
                    : 'text-medium-gray hover:text-secondary-white'
                }`}
              >
                Teams
              </button>
            </div>
          </motion.div>

          {/* Individual Plans */}
          {!showEnterprise && (
            <motion.div
              variants={itemVariants}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 flex-wrap"
            >
              {individualPlans.map((plan) => (
                <div
                  key={plan.name}
                  className={`glass-container p-6 md:p-8 relative flex flex-col min-h-[200px] ${
                    plan.highlight
                      ? 'border-cosmic-orange/50 bg-cosmic-orange/5'
                      : ''
                  }`}
                >
                  {plan.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-cosmic-orange text-black text-xs font-bold rounded-full">
                      {plan.badge}
                    </div>
                  )}

                  <h3 className="text-xl md:text-2xl font-bold text-secondary-white mb-2">
                    {plan.name}
                  </h3>
                  <div className="min-h-[4.5rem] text-sm text-medium-gray space-y-1 mb-6">
                    <p className="leading-tight">{plan.subtitle1}</p>
                    <p className="leading-tight">{plan.subtitle2}</p>
                  </div>

                  <div className="mt-auto">
                    <a
                      href={plan.name === 'Usage-Based' ? 'mailto:support@diffuse.ai?subject=Usage-based%20plan%20inquiry' : '/login'}
                      className={`block w-full py-3 text-center font-medium rounded-glass transition-all ${
                        plan.highlight
                          ? 'bg-cosmic-orange hover:bg-rich-orange text-black'
                          : 'bg-white/10 hover:bg-white/20 text-secondary-white'
                      }`}
                    >
                      {plan.cta}
                    </a>
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {/* Enterprise Plans */}
          {showEnterprise && (
            <motion.div
              variants={itemVariants}
              className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-4xl mx-auto flex-wrap"
            >
              {enterprisePlans.map((plan, index) => (
                <div
                  key={plan.name}
                  className={`glass-container p-6 md:p-8 flex flex-col min-h-[200px] ${index === 1 ? 'border-accent-purple/50 bg-accent-purple/5' : ''}`}
                >
                  <h3 className="text-xl md:text-2xl font-bold text-secondary-white mb-2">
                    {plan.name}
                  </h3>
                  <div className="min-h-[4.5rem] text-sm text-medium-gray space-y-1 mb-6">
                    <p className="leading-tight">{plan.subtitle1}</p>
                    <p className="leading-tight">{plan.subtitle2}</p>
                  </div>

                  <div className="mt-auto">
                    <a
                      href={plan.name === 'Team Max' ? 'mailto:support@diffuse.ai' : '/login'}
                      className={`block w-full py-3 text-center font-medium rounded-glass transition-all ${
                        index === 1
                          ? 'bg-accent-purple hover:bg-accent-purple/80 text-black'
                          : 'bg-white/10 hover:bg-white/20 text-secondary-white'
                      }`}
                    >
                      {plan.cta}
                    </a>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </motion.div>
      </div>
    </section>
  )
}
