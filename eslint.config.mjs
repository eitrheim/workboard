import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

const browserGlobals = {
  AbortController: "readonly",
  Blob: "readonly",
  DOMParser: "readonly",
  File: "readonly",
  FileReader: "readonly",
  FormData: "readonly",
  Image: "readonly",
  ResizeObserver: "readonly",
  URL: "readonly",
  WebAssembly: "readonly",
  alert: "readonly",
  cancelAnimationFrame: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  crypto: "readonly",
  document: "readonly",
  fetch: "readonly",
  indexedDB: "readonly",
  localStorage: "readonly",
  navigator: "readonly",
  requestAnimationFrame: "readonly",
  setTimeout: "readonly",
  window: "readonly",
};

const nodeGlobals = {
  AbortController: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  fetch: "readonly",
  process: "readonly",
  setTimeout: "readonly",
};

export default [
  {
    ignores: ["dist/**", "node_modules/**", ".openai/**"],
  },
  {
    files: [
      "src/**/*.{js,jsx}",
      "server/**/*.mjs",
      "worker/**/*.js",
      "shared/**/*.mjs",
      "scripts/**/*.mjs",
      "tests/**/*.mjs",
    ],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...nodeGlobals,
        ...browserGlobals,
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": ["error", { args: "none", ignoreRestSiblings: true }],
      "react/jsx-uses-vars": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
