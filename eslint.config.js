import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/dist-protected/**', '**/.dcm/**', '**/.next/**', '**/.next-protected/**', '**/node_modules/**', 'examples/*/public/**', '**/*.tsbuildinfo'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', performance: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', document: 'readonly', window: 'readonly', self: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['tests/fixtures/**', '.claude/skills/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);
