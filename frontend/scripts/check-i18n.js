// Checks the translation files: both languages must have the same keys and
// the same {{placeholders}}, and every key used in the source must exist.
// Usage: npm run i18n:check
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const SRC = new URL("../src/", import.meta.url).pathname;
const LANGUAGES = ["en", "it"];
// String literals that look like keys but are not translation keys.
const NOT_KEYS = new Set(["konto.language"]);
// i18next plural suffixes: "count_one" / "count_other" are used as "count".
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(object, prefix = "") {
  return Object.entries(object).flatMap(([key, value]) =>
    typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]],
  );
}

function placeholders(text) {
  return [...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(",");
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(js|jsx)$/.test(name) ? [path] : [];
  });
}

const problems = [];
const translations = Object.fromEntries(
  LANGUAGES.map((lang) => [
    lang,
    new Map(flatten(JSON.parse(readFileSync(join(SRC, "locales", `${lang}.json`), "utf8")))),
  ]),
);

// 1) Same keys and placeholders in every language
const [reference, ...others] = LANGUAGES;
for (const lang of others) {
  for (const key of translations[reference].keys()) {
    if (!translations[lang].has(key)) problems.push(`${lang}.json is missing "${key}"`);
    else if (placeholders(translations[reference].get(key)) !== placeholders(translations[lang].get(key)))
      problems.push(`"${key}" has different {{placeholders}} in ${reference} and ${lang}`);
  }
  for (const key of translations[lang].keys()) {
    if (!translations[reference].has(key)) problems.push(`${reference}.json is missing "${key}"`);
  }
}

// 2) Every key-like string literal in the source exists (dynamic keys such
// as `errors.${code}` cannot be checked statically).
const knownKeys = new Set(
  [...translations[reference].keys()].map((key) => key.replace(PLURAL_SUFFIX, "")),
);
for (const file of sourceFiles(SRC)) {
  if (file.includes("/locales/")) continue;
  const source = readFileSync(file, "utf8");
  for (const [, key] of source.matchAll(/["'`]([a-z][A-Za-z]*\.[A-Za-z_.]+)["'`]/g)) {
    if (!NOT_KEYS.has(key) && !/\.(js|jsx|json|css|svg|png)$/.test(key) && !knownKeys.has(key)) {
      problems.push(`${file.replace(SRC, "src/")} uses unknown key "${key}"`);
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`i18n OK: ${translations[reference].size} keys in ${LANGUAGES.join(", ")}`);
}
