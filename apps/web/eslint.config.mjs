// ESLint flat config for @bbm/web. Extends the root config (ESLint flat
// config resolution does not cascade from parent directories once a config
// file exists here, so we explicitly import and spread the root config) and
// layers on React Hooks rules for the Next.js App Router code in this app.
import reactHooks from "eslint-plugin-react-hooks";
import rootConfig from "../../eslint.config.mjs";

export default [
  ...rootConfig,
  {
    ignores: [".next/**", "next-env.d.ts"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Mock seed data / handlers intentionally use `any` in a few spots to
    // keep the in-memory DB generic; relax the rule there only.
    files: ["mocks/**/*.ts", "src/mocks/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
