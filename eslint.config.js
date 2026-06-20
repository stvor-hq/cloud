import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.eslint.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // No any
      '@typescript-eslint/no-explicit-any': 'error',
      // No unused vars
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Consistent type imports
      '@typescript-eslint/consistent-type-imports': 'warn',
      // No non-null assertions without justification
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // Prefer const
      'prefer-const': 'error',
      // No console in src (only in demo.ts)
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Demo and tests can use console freely
    files: ['src/demo.ts', 'tests/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.js'],
  },
];
