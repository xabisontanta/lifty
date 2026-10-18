import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default defineConfig(
  { ignores: ['node_modules/**', 'dist/**', '.local-stack/**', 'android/**', 'test-results*/**', 'playwright-report*/**', 'src/domain/database.types.ts', 'supabase/functions/find-matches/engine/**'] },
  {
    files: ['scripts/**/*.mjs', '*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: Object.fromEntries(['process', 'console', 'Buffer', 'URL', 'fetch', 'Headers', 'Request', 'Response', 'AbortSignal', 'AbortController', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'TextEncoder', 'TextDecoder', 'crypto', 'atob', 'btoa', 'structuredClone'].map(name => [name, 'readonly'])),
    },
    rules: { 'no-unused-vars': 'off', 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'supabase/functions/find-matches/{core,handler}.ts', 'supabase/functions/vehicle-illustration/handler.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: {
      // Existing JSON adapters intentionally accept heterogeneous backend payloads.
      '@typescript-eslint/no-explicit-any': 'off',
      // Avoid a broad cleanup of older screen imports in this focused repair.
      '@typescript-eslint/no-unused-vars': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
