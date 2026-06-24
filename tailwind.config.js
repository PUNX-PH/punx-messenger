/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Surfaces — darkest at the edges, lightest where you read
        bg: {
          deepest: '#0A0E14',   // server/group rail
          dark:    '#13161C',   // channel sidebar
          main:    '#1A1E26',   // chat surface
          raised:  '#22272F',   // composer, modal, hovered row
          hover:   '#2D323D',   // hovered button/list-item
        },
        line: {
          subtle: '#2D323D',
          strong: '#3A4150',
        },
        ink: {
          DEFAULT: '#E5E7EB',
          muted:   '#B0B6C0',
          dim:     '#6B7280',
        },
        brand: {
          DEFAULT: '#5865F2',   // punx blurple
          hover:   '#4752C4',
          soft:    '#5865F226',
        },
        ok:    '#10B981',
        warn:  '#F59E0B',
        bad:   '#EF4444',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs:   ['0.75rem',  { lineHeight: '1rem' }],
        sm:   ['0.8125rem',{ lineHeight: '1.15rem' }],
        base: ['0.9375rem',{ lineHeight: '1.4rem' }],
        lg:   ['1.0625rem',{ lineHeight: '1.5rem' }],
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '12px',
      },
      boxShadow: {
        elev1: '0 1px 0 rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.2)',
        elev2: '0 4px 16px rgba(0,0,0,0.32)',
      },
      transitionDuration: { 150: '150ms', 200: '200ms' },
    },
  },
  plugins: [],
}
