import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Primary Colors
        'dark-gray': '#141414',
        'black': '#000000',
        'secondary-white': '#dbdbdb',
        'cosmic-orange': '#ff9628',
        'medium-gray': '#545454',
        // Secondary Colors
        'pale-blue': '#90efff',
        'dusty-blue': '#447aa6',
        'rich-orange': '#ff7300',
        'off-white': '#f4f4f4',
        // Accent Colors
        'accent-purple': '#c086fa',
      },
      fontFamily: {
        mono: ['Space Grotesk', 'sans-serif'],
      },
      fontSize: {
        // Design system typography
        'display-xl': ['5rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }], // 80px
        'display-lg': ['4rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }], // 64px
        'display-md': ['3rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }], // 48px
        'display-sm': ['2.25rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }], // 36px
        'heading-xl': ['2rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }], // 32px
        'heading-lg': ['1.5rem', { lineHeight: '1.4', letterSpacing: '0' }], // 24px
        'heading-md': ['1.25rem', { lineHeight: '1.4', letterSpacing: '0' }], // 20px
        'body-lg': ['1.125rem', { lineHeight: '1.6', letterSpacing: '0' }], // 18px
        'body-md': ['1rem', { lineHeight: '1.6', letterSpacing: '0' }], // 16px
        'body-sm': ['0.875rem', { lineHeight: '1.6', letterSpacing: '0' }], // 14px
        'caption': ['0.75rem', { lineHeight: '1.5', letterSpacing: '0.02em' }], // 12px
      },
      spacing: {
        // Design system spacing
        '18': '4.5rem',
        '20': '5rem',
        '22': '5.5rem',
        '26': '6.5rem',
        '30': '7.5rem',
        '34': '8.5rem',
      },
      scrollMargin: {
        '20': '5rem',
      },
      borderRadius: {
        'glass': '12px',
        'glass-sm': '12px',
      },
      backdropBlur: {
        'glass': '20px',
      },
      animation: {
        'fade-in': 'fadeIn 0.6s ease-out',
        'slide-up': 'slideUp 0.6s ease-out',
        'slide-down': 'slideDown 0.6s ease-out',
        'scale-in': 'scaleIn 0.5s ease-out',
        'float': 'float 6s ease-in-out infinite',
        'record-pulse': 'recordPulseGlow 2.2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(30px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-30px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        /** Dim orange breathing ring while recording (mic active) */
        recordPulseGlow: {
          '0%, 100%': {
            opacity: '0.35',
            boxShadow:
              '0 0 0 1px rgba(255, 150, 40, 0.22), 0 0 20px rgba(255, 150, 40, 0.12), 0 0 40px rgba(255, 150, 40, 0.06)',
          },
          '50%': {
            opacity: '0.85',
            boxShadow:
              '0 0 0 1px rgba(255, 150, 40, 0.45), 0 0 32px rgba(255, 150, 40, 0.22), 0 0 56px rgba(255, 150, 40, 0.12)',
          },
        },
      },
    },
  },
  plugins: [],
}
export default config

