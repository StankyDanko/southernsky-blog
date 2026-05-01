/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        sky: {
          bg: '#020617',
          card: '#0f172a',
          border: '#1e293b',
          text: '#f1f5f9',
          muted: '#94a3b8',
        },
        brand: {
          blue: '#3b82f6',
          green: '#22c55e',
        },
        tier: {
          foundations: '#22c55e',
          applied: '#3b82f6',
          professional: '#f59e0b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            '--tw-prose-body': theme('colors.sky.text'),
            '--tw-prose-headings': theme('colors.sky.text'),
            '--tw-prose-links': theme('colors.brand.blue'),
            '--tw-prose-bold': theme('colors.sky.text'),
            '--tw-prose-code': theme('colors.brand.green'),
            '--tw-prose-pre-bg': theme('colors.sky.card'),
            '--tw-prose-pre-code': theme('colors.sky.text'),
            '--tw-prose-quotes': theme('colors.sky.muted'),
            '--tw-prose-quote-borders': theme('colors.brand.blue'),
          },
        },
      }),
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
