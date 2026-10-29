/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'primary': 'var(--color-primary, #2e8b57)',
        'primary-light': 'var(--color-primary-light, #3cb371)',
        'bg-main': 'var(--color-muted-bg, #f5f5f5)',
        'text-main': 'var(--color-text-main, #333)',
        'text-secondary': 'var(--color-text-secondary, #555)',
        'border': 'var(--color-border, #e0e0e0)',
        'row-alt': 'var(--color-row-alt, #fafafa)',
        // Keeping some of the original design's specific colors that don't map directly
        'surface-card': '#ffffff',
        'surface-canvas': 'var(--color-muted-bg, #f1f5f9)',
        'on-surface': 'var(--color-text-main, #0d1c2e)',
        'on-surface-variant': 'var(--color-text-secondary, #3f4941)',
        'secondary': '#006d3d',
        'tertiary': '#005cab',
        'cell-edited-bg': '#fff3e0',
        'cell-edited-text': '#c25e00',
        'cell-edited-border': '#ff9800',
        'status-danger': '#dc3545',
        'cell-highlight-bg': '#d4edda',
        'cell-highlight-text': '#155724',
      },
      boxShadow: {
        'card': 'var(--shadow-card)',
        'btn-hover': 'var(--shadow-button-hover)',
      },
      borderRadius: {
        'md': 'var(--radius-md, 14px)',
        'lg': 'var(--radius-lg, 16px)',
      },
      spacing: {
        'sm': 'var(--spacing-sm, 8px)',
        'md': 'var(--spacing-md, 15px)',
        'lg': 'var(--spacing-lg, 30px)',
        'xl': 'var(--spacing-xl, 40px)',
      },
      fontFamily: {
        "body": ['Segoe UI', 'Tahoma', 'Geneva', 'Verdana', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
