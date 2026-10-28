import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Un MCP server por stdio NUNCA debe escribir en stdout: console.log rompe el protocolo
      "no-console": ["error", { allow: ["error", "warn"] }],
    },
  },
);
