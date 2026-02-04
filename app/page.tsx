'use client'

import Navbar from '@/components/Navbar'
import Hero from '@/components/Hero'
import HowItWorks from '@/components/HowItWorks'
import Features from '@/components/Features'
import UseCases from '@/components/UseCases'
import FAQ from '@/components/FAQ'
import Footer from '@/components/Footer'

export default function Home() {
  return (
    <>
      {/* Structured Data - Breadcrumb */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              {
                '@type': 'ListItem',
                position: 1,
                name: 'Home',
                item: 'https://diffuse.ai',
              },
            ],
          }),
        }}
      />
      
      <Navbar />
      <main className="relative overflow-hidden">
        <Hero />
        <HowItWorks />
        <Features />
        <UseCases />
        <FAQ />
        <Footer />
      </main>
    </>
  )
}
