module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:svelte/recommended',
    'prettier',
  ],
  plugins: ['@typescript-eslint'],
  ignorePatterns: ['*.cjs', '.svelte-kit/', 'build/', 'dist/'], // Added dist/
  overrides: [
    {
      files: ['*.svelte'],
      parser: 'svelte-eslint-parser',
      parserOptions: {
        parser: '@typescript-eslint/parser',
      },
    },
  ],
  settings: {
    svelte: {
      // Optionally, specify Svelte version or other settings
    },
  },
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2022, // Updated to a more recent ECMAScript version
  },
  env: {
    browser: true,
    es2021: true, // Updated
    node: true,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'svelte/no-at-html-tags': 'off',
  },
};
