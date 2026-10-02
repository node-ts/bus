// @ts-check
import eslint from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'docs/api/**',
      'docs/.vitepress/cache/**'
    ]
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node
    },
    rules: {
      // `if (!!this.busInstance)` is the house style for BusConfiguration guards
      'no-extra-boolean-cast': 'off',
      // Public APIs take arbitrary payloads, and the specs lean on `as any`
      '@typescript-eslint/no-explicit-any': 'off',
      // `{}` is the default for the public transport message generics
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parserOptions: {
        // The docs have their own tsconfig, with the snippets and the VitePress config
        project: ['./tsconfig.eslint.json', './docs/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error'
    }
  },
  prettier
)
