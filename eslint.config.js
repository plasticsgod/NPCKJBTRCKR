// ESLint configuration (flat config, ESLint 9) for the NutraPack app.
// Focus: catch the crash-class bugs — undefined variables (e.g. a function used
// out of scope), bad/missing imports, and React hook mistakes — without being
// noisy about style. Run with: npm run lint
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  // Ignore build output and dependencies.
  { ignores: ["dist/**", "node_modules/**", "supabase/functions/**"] },

  // Base JS recommended rules.
  js.configs.recommended,

  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,   // window, document, fetch, crypto, etc.
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
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
      // --- The important ones (these catch real bugs) ---
      "no-undef": "error",                 // using an undefined variable → crash (caught deleteReply)
      "react/jsx-no-undef": "error",       // using an undefined component in JSX
      "react/jsx-uses-vars": "error",      // mark components used in JSX as "used" (kills false unused-var noise)
      "react/jsx-uses-react": "off",       // not needed with the automatic JSX runtime
      "react-hooks/rules-of-hooks": "error",   // hooks called conditionally → runtime error
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",

      // --- Helpful, but warnings so they don't block the build ---
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react-hooks/exhaustive-deps": "warn",

      // --- Turned off: too noisy / not relevant to a JSX-transform project ---
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",   // Vite's JSX transform doesn't need React in scope
      "react/no-unescaped-entities": "off",
    },
  },
];
