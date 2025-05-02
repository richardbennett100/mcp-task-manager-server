// .prettierrc.js
module.exports = {
    // Specify the line length that the printer will wrap on.
    printWidth: 120,
    // Specify the number of spaces per indentation-level.
    tabWidth: 2,
    // Indent lines with tabs instead of spaces.
    useTabs: false,
    // Print semicolons at the ends of statements.
    semi: true,
    // Use single quotes instead of double quotes.
    singleQuote: true,
    // Change when properties in objects are quoted.
    quoteProps: 'as-needed',
    // Use single quotes instead of double quotes in JSX.
    jsxSingleQuote: false,
    // Print trailing commas wherever possible in multi-line comma-separated syntax.
    trailingComma: 'es5', // Or 'all' if preferred
    // Print spaces between brackets in object literals.
    bracketSpacing: true,
    // Put the > of a multi-line HTML (HTML, JSX, Vue, Angular) element at the end of the last line instead of on a new line.
    bracketSameLine: false, // Deprecated in favor of bracketPropPlacement
    // Put the closing bracket of a tag on the same line as the last attribute.
    // bracketPropPlacement: 'last', // Use this instead of bracketSameLine
    // Include parentheses around a sole arrow function parameter.
    arrowParens: 'always',
    // Format only a subset of the changed files.
    // rangeStart: 0,
    // rangeEnd: Infinity,
    // Specify the parser to use.
    // parser: 'typescript', // Prettier auto-detects based on file extension
    // Specify the file(s) to format.
    // filepath: 'path/to/my.ts',
    // Require either @prettier or @format to be present in the file's contents to format it.
    requirePragma: false,
    // Insert @format pragma to the beginning of the file.
    insertPragma: false,
    // Use default wrapping (always)
    proseWrap: 'preserve',
    // Specify the HTML whitespace sensitivity.
    htmlWhitespaceSensitivity: 'css',
    // Whether to format the contents of the {{#*inline}} and {{#*inline}} blocks.
    // embeddedLanguageFormatting: 'auto', // Default
    // Trailing commas in functions.
    // trailingComma: 'all', // You can use 'all' for function parameters too
  
    // Add any other Prettier options as needed.
  };