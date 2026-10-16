import i18n from "../i18n";

// Localized text for an API error body ({ ok: false, code, message }), or the
// text of `fallbackKey` when the code is missing or unknown.
export function errorMessage(body, fallbackKey = "errors.generic") {
  const key = `errors.${body?.code}`;
  return body?.code && i18n.exists(key) ? i18n.t(key) : i18n.t(fallbackKey);
}
