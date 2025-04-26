module.exports = {
    root: true,
    parser: '@typescript-eslint/parser', // Specifies the ESLint parser
    parserOptions: {
      ecmaVersion: 2021, // Allows for the parsing of modern ECMAScript features
      sourceType: 'module', // Allows for the use of imports
      // project: ['./tsconfig.json'], // Optional: Path to your tsconfig.json for type-aware linting (recommended but might require setup)
    },
    plugins: [
      '@typescript-eslint', // Uses rules from the @typescript-eslint plugin
      'prettier', // Integrates Prettier rules
    ],
    extends: [
      'eslint:recommended', // Use the default recommended ESLint rules
      'plugin:@typescript-eslint/recommended', // Use the recommended rules from @typescript-eslint/eslint-plugin
      // 'plugin:@typescript-eslint/recommended-requiring-type-checking', // Optional: Stricter type-aware rules (requires 'project' in parserOptions)
      'plugin:prettier/recommended', // Enables eslint-plugin-prettier and eslint-config-prettier. Displays prettier errors as ESLint errors. Make sure this is always the last configuration in the extends array.
    ],
    env: {
      node: true, // Enable Node.js global variables and Node.js scoping.
      es2021: true, // Add global variables for ES2021 features.
    },
    rules: {
      // Place to specify ESLint rules. Can be used to overwrite rules specified from the extended configs
      // e.g. "@typescript-eslint/explicit-function-return-type": "off",
      '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }], // Warn about unused vars, except those starting with _
      '@typescript-eslint/no-explicit-any': 'warn', // Warn on usage of 'any' type
      'no-console': 'warn', // Warn about console.log statements (useful for production) - comment out if needed for debugging
      // Add other custom rules here
    },
    ignorePatterns: [
        'node_modules/',
        'dist/',
        '.eslintrc.js', // Don't lint the lint config itself
        '.prettierrc.js',
        // Add other patterns to ignore
      ],
  };