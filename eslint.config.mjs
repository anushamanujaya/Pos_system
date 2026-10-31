import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/uploads*/**',
      'playwright-report/**',
      'test-results/**',
      '.mongo-data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  { files: ['backend/src/database/**'], rules: { 'no-console': 'off' } }, // CLI scripts print to stdout
  { files: ['**/*.test.ts', '**/*.test.tsx', 'backend/tests/**', 'e2e/**'], rules: { 'no-console': 'off' } },
);
