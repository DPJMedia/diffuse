'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'

type FooterLink = { name: string; href: string; external?: boolean }

// Product: main nav sections. Solutions: use cases / capabilities. Company: contact & partners.
const footerLinks: { product: FooterLink[]; solutions: FooterLink[]; company: FooterLink[] } = {
  product: [
    { name: 'How It Works', href: '#how-it-works' },
    { name: 'Features', href: '#features' },
    { name: 'FAQ', href: '#faq' },
  ],
  solutions: [
    { name: 'Live Example', href: '#use-cases' },
    { name: 'Capabilities', href: '#features' },
    { name: 'Team collaboration', href: '#features' },
  ],
  company: [
    { name: 'Contact', href: 'mailto:prestonschlagheck@gmail.com' },
    { name: 'Spring-Ford Press', href: 'https://springford.press', external: true },
  ],
}

export default function Footer() {
  return (
    <footer className="relative border-t border-white/5">
      <div className="container-padding py-12 md:py-16">
        <div className="max-w-7xl mx-auto">
          {/* Main Footer Grid */}
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            {/* Brand Column */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="md:col-span-1"
            >
              <h2 className="text-2xl sm:text-3xl font-bold mb-3">
                diffuse<span className="text-cosmic-orange">.ai</span>
              </h2>
              <p className="text-sm text-medium-gray mb-6">
                The raw material of local reporting, organized, drafted, and verified by people.
              </p>
              <Link 
                href="/login" 
                className="btn-primary inline-block px-5 py-2.5 text-sm"
              >
                Start Free
              </Link>
            </motion.div>

            {/* Product Links */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              <h3 className="text-sm font-semibold text-secondary-white uppercase tracking-wider mb-4">
                Product
              </h3>
              <ul className="space-y-3">
                {footerLinks.product.map((link) => (
                  <li key={link.name}>
                    <a
                      href={link.href}
                      className="text-sm text-medium-gray hover:text-cosmic-orange transition-colors"
                    >
                      {link.name}
                    </a>
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* Solutions Links */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <h3 className="text-sm font-semibold text-secondary-white uppercase tracking-wider mb-4">
                Solutions
              </h3>
              <ul className="space-y-3">
                {footerLinks.solutions.map((link) => (
                  <li key={link.name}>
                    <a
                      href={link.href}
                      target={link.external ? '_blank' : undefined}
                      rel={link.external ? 'noopener noreferrer' : undefined}
                      className="text-sm text-medium-gray hover:text-cosmic-orange transition-colors inline-flex items-center gap-1"
                    >
                      {link.name}
                      {link.external && (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* Company Links */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <h3 className="text-sm font-semibold text-secondary-white uppercase tracking-wider mb-4">
                Company
              </h3>
              <ul className="space-y-3">
                {footerLinks.company.map((link) => (
                  <li key={link.name}>
                    <a
                      href={link.href}
                      target={link.external ? '_blank' : undefined}
                      rel={link.external ? 'noopener noreferrer' : undefined}
                      className="text-sm text-medium-gray hover:text-cosmic-orange transition-colors inline-flex items-center gap-1"
                    >
                      {link.name}
                      {link.external && (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>

          {/* Bottom Section */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="pt-6 border-t border-white/5"
          >
            <p className="text-xs sm:text-sm text-medium-gray text-center">
              © {new Date().getFullYear()} diffuse.ai. All rights reserved.
            </p>
          </motion.div>
        </div>
      </div>
    </footer>
  )
}
