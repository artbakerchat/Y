/**
 * ESLint flat configuration for the Forge / Larboard monorepo.
 *
 * Covers:
 *   • Root JavaScript (Worker, server, scripts, tools) — ES2022 + Node globals
 *   • site/src TypeScript / TSX — strict TypeScript + React rules
 *
 * Run:
 *   npx eslint .                     # lint everything
 *   npx eslint src/ server.mjs       # lint Worker + server only
 *   npx eslint site/src/             # lint React frontend only
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  // ------------------------------------------------------------------
  // Files to ignore globally
  // ------------------------------------------------------------------
  {
    ignores: [
      'node_modules/**',
      'site/node_modules/**',
      'dist/**',
      'site/dist/**',
      '.wrangler/**',
      'coverage/**',
      '*.min.js',
    ],
  },

  // ------------------------------------------------------------------
  // Root JavaScript — Worker, server, scripts, tools
  // ------------------------------------------------------------------
  {
    files: ['src/**/*.js', 'server.mjs', 'tools/**/*.js', 'scripts/**/*.js', 'tests/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Cloudflare Worker / WinterCG globals
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        Headers: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        TextEncoder: 'readonly',
        // Node.js globals (scripts, server, tests)
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
    rules: {
      // Correctness
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-var': 'error',
      'prefer-const': 'error',

      // Style (non-formatting — use Prettier for whitespace)
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'curly': ['error', 'all'],
      'no-throw-literal': 'error',
      'no-return-assign': 'error',

      // Security
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },

  // ------------------------------------------------------------------
  // site/src TypeScript + React
  // ------------------------------------------------------------------
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['site/src/**/*.ts', 'site/src/**/*.tsx', 'site/vite.config.ts'],
  })),
  {
    files: ['site/src/**/*.ts', 'site/src/**/*.tsx', 'site/vite.config.ts'],
    languageOptions: {
      parserOptions: {
        project: './site/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript correctness
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',

      // Prefer modern patterns
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
    },
  },
];
