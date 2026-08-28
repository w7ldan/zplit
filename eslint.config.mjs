import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  { rules: { complexity: ["error", 20] } },
  globalIgnores([".next/**", "coverage/**", "out/**", "node_modules/**", "s.sh", "zip.cjs"]),
]);
