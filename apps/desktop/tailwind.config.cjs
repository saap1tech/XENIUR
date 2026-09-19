module.exports = {
  content: [require('node:path').join(__dirname, 'src/renderer/**/*.{ts,tsx,html}')],
  corePlugins: { preflight: false },
  theme: { extend: { colors: { background: 'var(--bg)', foreground: 'var(--text)' } } },
  plugins: [],
};
