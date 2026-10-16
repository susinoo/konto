import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import it from "./locales/it.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "it", label: "Italiano" },
];

// Language: the user's explicit choice (saved in localStorage from
// Settings), otherwise the browser language, otherwise English.
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, it: { translation: it } },
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true, // "it-IT", "en-GB"... map to "it", "en"
    load: "languageOnly",
    fallbackLng: "en",
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "konto.language",
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false }, // React already escapes output
    returnNull: false,
  });

// Keep <html lang> in sync for screen readers and browser features.
function syncDocumentLanguage(language) {
  document.documentElement.lang = language;
}
syncDocumentLanguage(i18n.resolvedLanguage);
i18n.on("languageChanged", () => syncDocumentLanguage(i18n.resolvedLanguage));

export default i18n;
