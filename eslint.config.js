import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "com.abrakazinga.codex-status-actions.sdPlugin/bin/**",
      "com.abrakazinga.codex-status-actions.sdPlugin/ui/**/*.js",
      "release/**",
      "eslint.config.js",
      "rollup.config.mjs"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }]
    }
  }
);
