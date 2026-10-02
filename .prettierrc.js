module.exports = {
  trailingComma: 'none',
  tabWidth: 2,
  semi: false,
  singleQuote: true,
  jsxSingleQuote: true,
  arrowParens: 'avoid',
  printWidth: 80,
  plugins: ['prettier-plugin-organize-imports'],
  overrides: [
    {
      // The plugin needs vue-tsc to organize imports in Vue files, and warns
      // on every file without it
      files: '*.vue',
      options: { plugins: [] }
    }
  ]
}
