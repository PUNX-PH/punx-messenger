/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Channels, not hex, referenced through CSS variables so one class on
      // <html> swaps the whole palette with no component changes.
      //
      // The `rgb(var(--x) / <alpha-value>)` form is required rather than
      // stylistic: this codebase uses Tailwind opacity modifiers
      // (bg-bad/10, bg-brand/15, bg-bg-raised/50, border-warn/40). Tailwind
      // rewrites those into `rgb(<value> / 0.1)`, so a variable holding a hex
      // string would produce invalid CSS and those surfaces would silently
      // disappear. Holding the channels keeps every modifier working.
      //
      // Values are the same two sets as the Android app's paletteDark and
      // paletteLight — see android_app/lib/theme/palette.dart. Keep them in
      // step; the clients are meant to look identical.
      colors: {
        bg: {
          deepest: 'rgb(var(--bg-deepest) / <alpha-value>)',
          dark:    'rgb(var(--bg-dark) / <alpha-value>)',
          main:    'rgb(var(--bg-main) / <alpha-value>)',
          raised:  'rgb(var(--bg-raised) / <alpha-value>)',
          hover:   'rgb(var(--bg-hover) / <alpha-value>)',
        },
        line: {
          subtle: 'rgb(var(--line-subtle) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted:   'rgb(var(--ink-muted) / <alpha-value>)',
          dim:     'rgb(var(--ink-dim) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          hover:   'rgb(var(--brand-hover) / <alpha-value>)',
          // Was #5865F226, i.e. brand at ~15%. Expressed against the same
          // variable so it tracks the brand colour in both themes instead of
          // being a third value to remember.
          soft:    'rgb(var(--brand) / 0.15)',
        },
        ok:    'rgb(var(--ok) / <alpha-value>)',
        warn:  'rgb(var(--warn) / <alpha-value>)',
        bad:   'rgb(var(--bad) / <alpha-value>)',
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
