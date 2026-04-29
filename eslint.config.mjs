import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['**/dist/**', '**/.turbo/**', '**/node_modules/**', '**/migrations/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
];
