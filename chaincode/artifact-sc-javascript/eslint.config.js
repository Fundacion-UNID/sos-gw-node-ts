"use strict";

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
        module: "readonly",
        require: "readonly",
        describe: "readonly",
        it: "readonly",
        beforeEach: "readonly",
      },
    },
  },
];
