"use strict";

/**
 * Local flat ESLint configuration for the self-contained JavaScript
 * chaincode package. The repository root intentionally has no ESLint runtime.
 */
module.exports = [
  {
    ignores: ["coverage/**", ".nyc_output/**", "node_modules/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        Buffer: "readonly",
        console: "readonly",
        module: "readonly",
        require: "readonly",
        describe: "readonly",
        it: "readonly",
        beforeEach: "readonly",
      },
    },
  },
];
