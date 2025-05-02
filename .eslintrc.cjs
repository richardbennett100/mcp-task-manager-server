// .eslintrc.cjs
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',
    'prettier', // Enable eslint-plugin-prettier
  ],
  extends: [
    'eslint:recommended', // ESLint's recommended rules
    'plugin:@typescript-eslint/recommended', // Recommended rules from @typescript-eslint
    // If you were using recommended-requiring-type-checking, you might need to keep it
    // if you still want other rules from it, but note that this rule is part of it.
    // 'plugin:@typescript-eslint/recommended-requiring-type-checking',

    // Disable ESLint rules that conflict with Prettier
    'plugin:prettier/recommended', // Use eslint-config-prettier and eslint-plugin-prettier
  ],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    // Required for rules that need type information (e.g., recommended-requiring-type-checking)
    // project: './tsconfig.json', // Point to your tsconfig.json
  },
  rules: {
    // Add any custom ESLint rules or overrides here.
    // Examples:
    // '@typescript-eslint/explicit-function-return-type': 'off',
    'prettier/prettier': 'error', // Report Prettier issues as ESLint errors

    // Disable the rule that disallows explicit 'any'
    '@typescript-eslint/no-explicit-any': 'off',
  },
  ignorePatterns: [
    'dist/', // Ignore build output directory
    'node_modules/', // Ignore node_modules
    'coverage/', // Ignore test coverage reports
    // Add any other files or directories to ignore
  ],
};