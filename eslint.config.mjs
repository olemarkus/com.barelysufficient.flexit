import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';

export default tseslint.config(
  {
    // Lint TypeScript sources only, matching the pre-flat-config `--ext .ts` scope.
    // `.homeybuild` is Homey's build output and a stray TSConfig root candidate.
    ignores: ['localdocs/**', '.homeybuild/**', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      importX.flatConfigs.recommended,
      importX.flatConfigs.typescript,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          project: './tsconfig.eslint.json',
        },
      },
    },
    rules: {
      'max-len': ['error', 120],
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
      'import-x/extensions': ['error', 'ignorePackages', { js: 'never', ts: 'never' }],
      'import-x/prefer-default-export': 'off',
      'import-x/no-named-as-default-member': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
      // Newly added to ESLint 10's `recommended` set. Disabled here to keep this
      // dependency upgrade free of code changes; adopt deliberately in a follow-up.
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      complexity: ['error', 25],
      'max-depth': ['error', 4],
      'max-nested-callbacks': ['error', 4],
      'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true }],
      'max-params': ['error', 4],
      'max-statements': ['error', 35],
    },
  },
  {
    files: ['scripts/**/*.ts'],
    rules: {
      complexity: ['error', 60],
      'max-depth': ['error', 6],
      'max-lines': ['error', { max: 1700, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 220, skipBlankLines: true, skipComments: true, IIFEs: true }],
      'max-params': ['error', 8],
      'max-statements': ['error', 100],
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.mocha,
      },
    },
    rules: {
      'import-x/extensions': 'off',
      'import-x/first': 'off',
      'import-x/newline-after-import': 'off',
      'import-x/order': 'off',
      'object-curly-newline': 'off',
      'max-classes-per-file': 'off',
      complexity: 'off',
      'max-depth': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-params': 'off',
      'max-statements': 'off',
    },
  },
  {
    files: ['vitest.config.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': 'off',
    },
  },
  {
    files: ['lib/createAppClass.ts'],
    rules: {
      'max-lines-per-function': 'off',
    },
  },
);
