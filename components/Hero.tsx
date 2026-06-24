'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

// Mock article for the output phase: a realistic local story drafted from a meeting,
// reviewed and bylined by a person. Shows real coverage, not a pitch for Diffuse.
const mockArticle = {
  title: "Limerick Township Approves 2026 Budget After Public Comment",
  subtitle: "Supervisors voted 4 to 1, holding the tax rate flat",
  author: "Jane Smith",
  excerpt: "Limerick Township supervisors approved a 2026 budget on Tuesday after an hour of public comment, holding the tax rate flat while shifting funds toward road repairs.",
  content: "Limerick Township supervisors approved a 2026 budget on Tuesday after an hour of public comment, holding the tax rate flat while shifting funds toward road repairs.\n\nThe board voted 4 to 1, with one supervisor opposed over the pace of the road plan. Residents who spoke were split between faster paving and keeping reserves for the new public works building.\n\nThe approved budget takes effect January 1. A full schedule of road projects is due at the February meeting."
}

// Short mock for mobile hero: one-line title, one-line subtitle, three-line body
const mockArticleMobile = {
  title: "Limerick approves 2026 budget",
  subtitle: "Supervisors vote 4 to 1, tax rate held flat",
  author: "Jane Smith",
  content: "Limerick Township supervisors approved a 2026 budget on Tuesday.\nThe board voted 4 to 1 after an hour of public comment.\nThe tax rate stays flat, with more money going to road repairs."
}

// Match real project page: label, color, icon path, title, optional sub (e.g. duration), date
const INPUT_TYPES = [
  { type: 'recording', label: 'RECORDING', title: 'Board meeting 3.12', sub: '4:32', color: 'text-rose-400', date: 'Mar 10, 2025', path: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z' },
  { type: 'text', label: 'TEXT', title: 'Budget memo, FY2026', sub: '', color: 'text-indigo-400', date: 'Mar 10, 2025', path: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { type: 'web_scrape', label: 'WEB SCRAPE', title: 'diffuse.ai/blog', sub: '', color: 'text-sky-400', date: 'Mar 11, 2025', path: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9' },
  { type: 'document', label: 'DOCUMENT', title: 'Q1 Report.pdf', sub: '', color: 'text-emerald-400', date: 'Mar 11, 2025', path: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z' },
  { type: 'image', label: 'IMAGE', title: 'Product screenshot', sub: '', color: 'text-yellow-400', date: 'Mar 11, 2025', path: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { type: 'recording', label: 'RECORDING', title: 'Interview clip', sub: '2:15', color: 'text-rose-400', date: 'Mar 12, 2025', path: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z' },
  { type: 'document', label: 'DOCUMENT', title: 'Talking points.docx', sub: '', color: 'text-emerald-400', date: 'Mar 12, 2025', path: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z' },
] as const

type Tab = 'inputs' | 'outputs' | 'visibility'
type Phase = 'inputs' | 'outputs-empty' | 'output' | 'visibility'

const WorkflowDemo = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const isMobileRef = useRef(false)
  const [isMobile, setIsMobile] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('inputs')
  const [phase, setPhase] = useState<Phase>('inputs')
  const [visibleInputCount, setVisibleInputCount] = useState(0)
  const [showAddDropdown, setShowAddDropdown] = useState(false)
  const [generateClicked, setGenerateClicked] = useState(false)
  const [typedTitle, setTypedTitle] = useState('')
  const [typedContent, setTypedContent] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [showCursor, setShowCursor] = useState(true)
  const [selectedTeams, setSelectedTeams] = useState<string[]>([])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => {
      isMobileRef.current = mq.matches
      setIsMobile(mq.matches)
    }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Main timeline (no mouse; dropdown opens once, inputs add one by one)
  useEffect(() => {
    let timeouts: NodeJS.Timeout[] = []
    const add = (fn: () => void, ms: number) => { timeouts.push(setTimeout(fn, ms)) }

    const runCycle = () => {
      setPhase('inputs')
      setActiveTab('inputs')
      setVisibleInputCount(0)
      setShowAddDropdown(false)
      setGenerateClicked(false)
      setTypedTitle('')
      setTypedContent('')
      setVisibility('private')
      setSelectedTeams([])
      let t = 0

      // Add Input clicked → dropdown opens (show for a bit longer)
      add(() => setShowAddDropdown(true), t); t += 1400
      // Add Input clicked again (or dismiss) → dropdown closes and disappears
      add(() => setShowAddDropdown(false), t); t += 800
      // After dropdown is closed: input 1, then 2; on mobile stop at 2, on desktop add 3–7
      add(() => {
        setShowAddDropdown(false)
        setVisibleInputCount(1)
      }, t); t += 600
      add(() => setVisibleInputCount(2), t); t += 550
      if (!isMobileRef.current) {
        add(() => setVisibleInputCount(3), t); t += 550
        add(() => setVisibleInputCount(4), t); t += 550
        add(() => setVisibleInputCount(5), t); t += 550
        add(() => setVisibleInputCount(6), t); t += 550
        add(() => setVisibleInputCount(7), t); t += 900
      } else {
        t += 700
      }

      // Switch to Outputs tab
      add(() => { setActiveTab('outputs'); setPhase('outputs-empty'); }, t); t += 600

      // Generate clicked → show article (no loading screen)
      add(() => {
        setGenerateClicked(true)
        setPhase('output')
      }, t); t += 500

      // Article types out
      t += 4200

      // Switch to Visibility tab
      add(() => { setActiveTab('visibility'); setPhase('visibility'); }, t); t += 500
      add(() => setVisibility('public'), t); t += 400
      add(() => setSelectedTeams(['Spring-Ford Press']), t); t += 500
      add(() => setSelectedTeams(['Spring-Ford Press', 'City News Desk']), t); t += 2000

      add(runCycle, t)
    }

    runCycle()
    return () => timeouts.forEach(clearTimeout)
  }, [])

  // Use short article on mobile (one-line title, one-line subtitle, four-line body)
  const article = isMobile ? mockArticleMobile : mockArticle
  const fullBody = isMobile ? mockArticleMobile.content : (mockArticle.excerpt + '\n\n' + mockArticle.content)

  useEffect(() => {
    if (phase !== 'output') return
    const art = isMobileRef.current ? mockArticleMobile : mockArticle
    let i = 0
    const iv = setInterval(() => {
      if (i < art.title.length) {
        setTypedTitle(art.title.slice(0, i + 1))
        i++
      } else clearInterval(iv)
    }, 22)
    return () => clearInterval(iv)
  }, [phase])
  useEffect(() => {
    if (phase !== 'output') return
    const art = isMobileRef.current ? mockArticleMobile : mockArticle
    const body = isMobileRef.current ? mockArticleMobile.content : (mockArticle.excerpt + '\n\n' + mockArticle.content)
    const delay = setTimeout(() => {
      let i = 0
      const iv = setInterval(() => {
        if (i < body.length) {
          setTypedContent(body.slice(0, i + 1))
          i++
        } else clearInterval(iv)
      }, 5)
      return () => clearInterval(iv)
    }, art.title.length * 22 + 180)
    return () => clearTimeout(delay)
  }, [phase])

  // Cursor blink
  useEffect(() => {
    const iv = setInterval(() => setShowCursor(c => !c), 500)
    return () => clearInterval(iv)
  }, [])

  return (
    <div ref={containerRef} className="relative w-full max-w-6xl mx-auto overflow-x-hidden">
      <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-1/2 left-1/4 w-72 h-72 bg-cosmic-orange/15 rounded-full blur-[100px] -translate-y-1/2" />
        <div className="absolute top-1/2 right-1/4 w-56 h-56 bg-accent-purple/10 rounded-full blur-[80px] -translate-y-1/2" />
      </div>

      <div className="glass-container overflow-hidden shadow-2xl shadow-black/50">
        <div className="flex items-center justify-center px-4 py-3 border-b border-white/10 bg-black/40 relative">
          <div className="absolute left-4 flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          </div>
          <span className="text-sm text-medium-gray font-medium">diffuse.ai</span>
        </div>

        <div className="h-[420px] sm:h-[440px] md:h-[520px] bg-[#0a0a0a] flex overflow-hidden">
          {/* Left sidebar - mock dashboard nav (full labels, proper icons) */}
          <aside className="hidden md:flex w-52 flex-shrink-0 border-r border-white/10 flex-col bg-white/[0.06] py-4 px-3">
            <div className="mb-4">
              <span className="text-lg font-bold text-secondary-white">diffuse</span>
              <span className="text-lg font-bold text-cosmic-orange">.ai</span>
            </div>
            <div className="space-y-0.5">
              {[
                { name: 'Organizations', path: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
                { name: 'Projects', path: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
                { name: 'Advertisements', path: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' },
                { name: 'Shared With Me', path: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
                { name: 'Recordings', path: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z' },
              ].map((item) => (
                <div key={item.name} className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-secondary-white">
                  <svg className="w-5 h-5 flex-shrink-0 text-current" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.path} /></svg>
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
            <div className="flex-1 min-h-2" />
            <div className="pt-3 border-t border-white/10">
              <div className="px-3 py-2.5 rounded-lg bg-white/5 text-xs">
                <div className="text-secondary-white font-medium">User</div>
                <div className="text-cosmic-orange text-xs uppercase tracking-wider">Pro</div>
              </div>
            </div>
          </aside>

          {/* Main content area */}
          <div className="flex-1 min-w-0 relative overflow-hidden">
          <AnimatePresence mode="wait">
            {/* INPUTS TAB */}
            {phase === 'inputs' && (
              <motion.div
                key="inputs"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 p-4 md:p-6 flex flex-col"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <button className="text-medium-gray p-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <h2 className="text-sm font-semibold text-secondary-white truncate">Launch Coverage</h2>
                  </div>
                  <div className="relative">
                    <button type="button" className="btn-primary px-3 py-1.5 text-xs font-medium rounded-lg gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      Add Input
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    <AnimatePresence>
                      {showAddDropdown && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          className="absolute right-0 mt-2 w-52 glass-container py-2 z-50"
                        >
                          {[
                            { label: 'Recording', sub: 'FROM YOUR RECORDINGS', color: 'text-rose-400', path: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z' },
                            { label: 'Text', sub: 'TYPE OR PASTE TEXT', color: 'text-indigo-400', path: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
                            { label: 'Web Scraping', sub: 'INSERT URL', color: 'text-sky-400', path: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9' },
                            { label: 'Audio File', sub: 'MP3, WAV, M4A', color: 'text-fuchsia-400', path: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' },
                            { label: 'Document', sub: 'PDF, DOCX, TXT', color: 'text-emerald-400', path: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z' },
                            { label: 'Cover Photo', sub: 'MAIN ARTICLE PHOTO', color: 'text-lime-400', path: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
                          ].map((item) => (
                            <div key={item.label} className="px-3 py-2.5 flex items-center gap-3 text-left">
                              <svg className={`w-4 h-4 flex-shrink-0 ${item.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.path} /></svg>
                              <div>
                                <p className="text-xs text-secondary-white">{item.label}</p>
                                <p className="text-xs text-medium-gray uppercase tracking-wider">{item.sub}</p>
                              </div>
                            </div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div className="flex gap-4 border-b border-white/10 mb-4">
                  <button className="pb-2 text-xs font-medium text-cosmic-orange border-b-2 border-cosmic-orange">Inputs ({visibleInputCount})</button>
                  <button className="pb-2 text-xs font-medium text-medium-gray">Outputs (0)</button>
                  <button className="pb-2 text-xs font-medium text-medium-gray">Visibility</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 overflow-y-auto min-h-0">
                  {INPUT_TYPES.slice(0, visibleInputCount).map((input, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="glass-container p-6"
                    >
                      <div className={`flex items-center gap-2 text-xs uppercase tracking-wider ${input.color}`}>
                        <span className="flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={input.path} /></svg>
                        </span>
                        <span>
                          {input.label}
                          {input.sub ? <><span className="text-medium-gray"> • </span><span>{input.sub}</span></> : ''}
                        </span>
                      </div>
                      <h3 className="text-sm text-secondary-white font-medium mt-2 mb-1 line-clamp-2">
                        {input.title}
                      </h3>
                      <div className="text-xs text-medium-gray uppercase tracking-wider">
                        {input.date}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* OUTPUTS TAB (empty then generating then output) */}
            {activeTab === 'outputs' && phase === 'outputs-empty' && (
              <motion.div
                key="outputs-empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 p-4 md:p-6 flex flex-col"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <button className="text-medium-gray p-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
                    <h2 className="text-base md:text-lg font-semibold text-secondary-white">Launch Coverage</h2>
                  </div>
                  <div className="flex gap-2">
                    <button className="px-2.5 py-1.5 bg-white/10 border border-white/20 text-white text-xs rounded-lg">Quick</button>
                    <motion.button
                      type="button"
                      animate={{ scale: generateClicked ? 0.97 : 1 }}
                      className="btn-primary px-2.5 py-1.5 text-xs font-medium rounded-lg gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                      Generate
                    </motion.button>
                  </div>
                </div>
                <div className="flex gap-4 border-b border-white/10 mb-4">
                  <button className="pb-2 text-xs font-medium text-medium-gray">Inputs ({isMobile ? 2 : 7})</button>
                  <button className="pb-2 text-xs font-medium text-cosmic-orange border-b-2 border-cosmic-orange">Outputs (0)</button>
                  <button className="pb-2 text-xs font-medium text-medium-gray">Visibility</button>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center py-10">
                  <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3">
                    <svg className="w-6 h-6 text-medium-gray" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  </div>
                  <p className="text-xs text-medium-gray">No outputs yet</p>
                  <p className="text-xs text-medium-gray/80 mt-0.5">Click Generate to create your article</p>
                </div>
              </motion.div>
            )}

            {activeTab === 'outputs' && phase === 'output' && (
              <motion.div
                key="output"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 p-4 md:p-6 flex flex-col overflow-hidden"
              >
                <div className="flex items-center justify-between mb-3 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <button className="text-medium-gray p-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
                    <h2 className="text-base md:text-lg font-semibold text-secondary-white">Launch Coverage</h2>
                  </div>
                </div>
                <div className="flex gap-4 border-b border-white/10 mb-3 flex-shrink-0">
                  <button className="pb-2 text-xs font-medium text-medium-gray">Inputs ({isMobile ? 2 : 7})</button>
                  <button className="pb-2 text-xs font-medium text-cosmic-orange border-b-2 border-cosmic-orange">Outputs (1)</button>
                  <button className="pb-2 text-xs font-medium text-medium-gray">Visibility</button>
                </div>

                <div className="flex-1 min-h-0 overflow-hidden rounded-lg glass-container border border-white/10 flex flex-col">
                  <div className="p-4 flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 text-[10px] text-teal-400 uppercase tracking-wider">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        Article
                      </div>
                      <div className="flex gap-1.5">
                        <span className="px-2 py-0.5 bg-white/10 rounded text-[10px] text-secondary-white">Copy</span>
                        <span className="px-2 py-0.5 bg-cosmic-orange/20 text-cosmic-orange rounded text-[10px]">Edit</span>
                      </div>
                    </div>
                    <h3 className="text-base font-bold text-secondary-white mb-1.5 leading-tight min-h-[1.25rem]">
                      {typedTitle}
                      {typedTitle.length < article.title.length && showCursor && <span className="inline-block w-0.5 h-4 bg-white ml-0.5 align-middle animate-pulse" />}
                    </h3>
                    <p className="text-sm text-accent-purple italic mb-2">{article.subtitle}</p>
                    <div className="flex items-center gap-2 text-[10px] text-medium-gray uppercase tracking-wider mb-2 pb-2 border-b border-white/10">
                      <span className="text-cosmic-orange">By {article.author}</span>
                      <span>•</span>
                      <span>Just now</span>
                    </div>
                    <div className="text-sm text-secondary-white/85 leading-relaxed whitespace-pre-line">
                      {typedContent}
                      {typedContent.length < fullBody.length && showCursor && (
                        <span className="inline-block w-0.5 h-4 bg-white/80 ml-0.5 align-middle animate-pulse" />
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* VISIBILITY TAB */}
            {phase === 'visibility' && activeTab === 'visibility' && (
              <motion.div
                key="visibility"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 p-4 md:p-6 flex flex-col"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <button className="text-medium-gray p-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
                    <h2 className="text-base md:text-lg font-semibold text-secondary-white">Launch Coverage</h2>
                  </div>
                </div>
                <div className="flex gap-4 border-b border-white/10 mb-4">
                  <button className="pb-2 text-xs font-medium text-medium-gray">Inputs ({isMobile ? 2 : 7})</button>
                  <button className="pb-2 text-xs font-medium text-medium-gray">Outputs (1)</button>
                  <button className="pb-2 text-xs font-medium text-cosmic-orange border-b-2 border-cosmic-orange">Visibility</button>
                </div>
                <div className="flex justify-end gap-3 mb-4 flex-wrap">
                  <button className={`px-4 py-2 flex items-center gap-2 text-xs font-medium rounded-glass transition-colors ${visibility === 'private' ? 'btn-primary' : 'btn-secondary'}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    Private
                  </button>
                  <button className={`px-4 py-2 flex items-center gap-2 text-xs font-medium rounded-glass transition-colors ${visibility === 'public' ? 'btn-primary' : 'btn-secondary'}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                    Public
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 mb-6">
                  {['Spring-Ford Press', 'City News Desk'].map((name) => {
                    const isSelected = selectedTeams.includes(name)
                    return (
                      <div
                        key={name}
                        className={`glass-container p-6 transition-colors cursor-pointer ${
                          isSelected && visibility === 'public'
                            ? 'bg-cosmic-orange/20 border-cosmic-orange/30'
                            : ''
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="p-2 rounded-lg bg-white/5 text-cosmic-orange">
                            {isSelected && visibility === 'public' ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm text-secondary-white font-medium mb-1 break-words">
                              {name}
                            </h3>
                            <p className="text-xs text-medium-gray uppercase tracking-wider">
                              {isSelected && visibility === 'public' ? 'SHARED' : 'ORGANIZATION'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Hero() {
  const [user, setUser] = useState<User | null>(null)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [supabase.auth])

  return (
    <section className="relative min-h-screen flex items-center justify-center pt-20 sm:pt-24 md:pt-28 pb-12 md:pb-16">
      <div className="relative z-10 container-padding w-full">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-center mb-8 md:mb-10 px-4"
        >
          <h1 className="text-display-sm font-bold mb-4 leading-tight max-w-4xl mx-auto text-secondary-white">
            More local coverage. Judgment kept human.
          </h1>
          <p className="text-body-lg text-medium-gray max-w-2xl mx-auto">
            Diffuse pulls the raw material of local reporting into one workspace. AI does the labor of drafting. People decide what is newsworthy and verify what is true.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          <WorkflowDemo />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="w-full max-w-6xl mx-auto mt-6"
        >
          <div className="flex gap-3">
            <a href="#how-it-works" className="btn-secondary text-center text-sm sm:text-base py-3 md:py-4 flex-1">
              See How It Works
            </a>
            <a href={user ? "/dashboard" : "/login"} className="btn-primary text-center text-sm sm:text-base py-3 md:py-4 flex-1">
              {user ? "Go to Dashboard" : "Start Free"}
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
