import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import i18next from "eslint-plugin-i18next";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  // No hard-coded UI text (CLAUDE.md, M18). Only .tsx: text in a .ts file is always a
  // next-intl key (zod messages, AppError), which the typed Messages in global.d.ts and
  // tests/unit/message-keys.test.ts already check. That also leaves src/app/manifest.ts
  // alone, which is English on purpose (docs/decisions.md).
  {
    files: ["src/**/*.tsx"],
    ignores: [
      "src/app/dev/**", // developer-only component gallery, English on purpose
      "src/**/*.test.tsx", // fixture text, never shipped
    ],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          // The plugin defaults are replaced, not merged, so its own list is repeated
          // here. Ours: helpers whose string arguments are keys or class names.
          callees: {
            exclude: [
              "i18n(ext)?",
              "t",
              "t[A-Z]\\w*", // tApp, tAuth, tRole: the same t, bound to another namespace
              "require",
              "addEventListener",
              "removeEventListener",
              "postMessage",
              "getElementById",
              "dispatch",
              "commit",
              "includes",
              "indexOf",
              "endsWith",
              "startsWith",
              "errorFor",
              "cn",
              "clsx",
              "cva",
            ],
          },
          "object-properties": { exclude: ["[A-Z_-]+", "classNames", "toast", "icon"] },
          "jsx-attributes": {
            exclude: [
              "className",
              "class",
              "id",
              "key",
              "type",
              "name",
              "role",
              "slot",
              "form",
              "data-.*",
              "aria-hidden",
              "aria-current",
              "href",
              "src",
              "rel",
              "target",
              "value",
              "autoComplete",
              "inputMode",
              "pattern",
              "maxLength",
              "method",
              "action",
              "variant",
              "kind", // which master list a screen is showing, not text
              "size",
              "tone",
              "align",
              "side",
              "sideOffset",
              "style",
              "lang",
              "dir",
              "width",
              "height",
              "viewBox",
              "xmlns",
              "d",
              "fill",
              "stroke",
              "charSet",
              "toastOptions",
              ".*[Hh]ref", // backHref and friends: a path, not text
              ".*[Uu]rl",
              "position",
            ],
          },
          // Regex literals, not strings: the plugin compiles a string pattern without
          // the u flag, which turns the "any letter" class into three literal
          // characters and quietly skips ordinary text (it did — this rule silently
          // caught nothing until the patterns became literals).
          // Skips whitespace, anything with no letters
          // (separators, digits, punctuation) and all-caps enum-style tokens.
          words: { exclude: [/^\s*$/, /^[^\p{L}]+$/u, /^[A-Z_-]+$/] },
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
]);

export default eslintConfig;
