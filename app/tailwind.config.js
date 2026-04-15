/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/client/index.html',
    './src/client/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      typography: {
        sm: {
          css: {
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
            code: {
              backgroundColor: '#f3f4f6',
              padding: '0.125rem 0.375rem',
              borderRadius: '0.25rem',
              fontSize: '0.875em',
              fontWeight: '500',
            },
            'pre code': {
              backgroundColor: 'transparent',
              padding: '0',
              borderRadius: '0',
              fontSize: 'inherit',
              fontWeight: 'inherit',
            },
            pre: {
              backgroundColor: '#1f2937',
              color: '#f3f4f6',
              padding: '1rem',
              borderRadius: '0.5rem',
              overflow: 'auto',
            },
            table: {
              borderCollapse: 'collapse',
            },
            'thead th': {
              backgroundColor: '#f9fafb',
              fontWeight: '600',
              padding: '0.75rem 1rem',
              borderWidth: '1px',
              borderColor: '#e5e7eb',
              textAlign: 'left',
            },
            'tbody td': {
              padding: '0.75rem 1rem',
              borderWidth: '1px',
              borderColor: '#e5e7eb',
            },
            'tbody tr:nth-child(odd)': {
              backgroundColor: 'transparent',
            },
            'tbody tr:nth-child(even)': {
              backgroundColor: '#f9fafb',
            },
            h1: {
              marginTop: '1.5rem',
              marginBottom: '0.75rem',
            },
            h2: {
              marginTop: '1.25rem',
              marginBottom: '0.625rem',
            },
            h3: {
              marginTop: '1rem',
              marginBottom: '0.5rem',
            },
            ul: {
              paddingLeft: '1.5rem',
            },
            ol: {
              paddingLeft: '1.5rem',
            },
            li: {
              marginTop: '0.25rem',
              marginBottom: '0.25rem',
            },
            blockquote: {
              borderLeftWidth: '4px',
              borderLeftColor: '#3b82f6',
              paddingLeft: '1rem',
              fontStyle: 'italic',
              color: '#4b5563',
            },
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
