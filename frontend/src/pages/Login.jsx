import { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiFetch, readJson } from "../services/api";
import { errorMessage } from "../utils/errors";

// Same rules as the backend validation (MIN_PASSWORD_LENGTH, USERNAME_PATTERN)
const MIN_PASSWORD_LENGTH = 8;
const USERNAME_PATTERN = "[A-Za-z0-9._\\-]{3,32}";

// `registrationEnabled` comes from /api/config (REGISTRATION_ENABLED on the
// server): without it the "Sign up" link is hidden.
export default function Login({ onAuthed, registrationEnabled = false }) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [form, setForm] = useState({ username: "", password: "", passwordConfirm: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const isRegister = mode === "register";

  const toggleMode = () => {
    setMode(isRegister ? "login" : "register");
    setError("");
    setShowForgot(false);
    setForm({ username: "", password: "", passwordConfirm: "" });
  };

  const togglePolicy = () => setShowPolicy((prev) => !prev);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.username || !form.password) return;
    if (isRegister && form.password !== form.passwordConfirm) {
      setError(t("errors.PASSWORDS_DO_NOT_MATCH"));
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch(isRegister ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify(
          // The language picks the names of the new user's default
          // categories and account.
          isRegister
            ? { ...form, locale: i18n.resolvedLanguage }
            : { username: form.username, password: form.password },
        ),
      });
      const data = await readJson(res);

      if (!res.ok) {
        setError(
          errorMessage(data, isRegister ? "login.registerFailed" : "errors.INVALID_CREDENTIALS"),
        );
        return;
      }

      // The backend set the session cookie: just pass the user up.
      onAuthed(data.user, { justRegistered: isRegister });
    } catch (err) {
      if (String(err?.message || "") === "NOT_AUTHORIZED") {
        // A failed login is a 401 too: apiFetch turns it into NOT_AUTHORIZED.
        setError(t("errors.INVALID_CREDENTIALS"));
      } else {
        setError(t("errors.network"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 transition-colors">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 border border-gray-100 dark:border-gray-700">
        <div className="flex flex-col items-center mb-8">
          <h1 className="flex items-center">
            <img
              src="/logo-color.svg"
              alt="Konto"
              className="h-10 w-auto dark:hidden"
            />
            <img
              src="/logo-white.svg"
              alt="Konto"
              className="h-10 w-auto hidden dark:block"
            />
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-5 text-sm">
            {isRegister
              ? t("login.registerSubtitle")
              : t("login.loginSubtitle")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t("login.username")}
            </label>
            <input
              type="text"
              required
              autoComplete="username"
              maxLength={32}
              pattern={isRegister ? USERNAME_PATTERN : undefined}
              title={
                isRegister
                  ? t("login.usernameHint")
                  : undefined
              }
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t("login.password")}
            </label>
            <input
              type="password"
              required
              autoComplete={isRegister ? "new-password" : "current-password"}
              minLength={isRegister ? MIN_PASSWORD_LENGTH : undefined}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              disabled={loading}
            />
            {!isRegister && (
              <div className="flex justify-end mt-2">
                <button
                  type="button"
                  onClick={() => setShowForgot((prev) => !prev)}
                  aria-expanded={showForgot}
                  className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
                >
                  {t("login.forgotPassword")}
                </button>
              </div>
            )}
          </div>

          {!isRegister && showForgot && (
            <div
              role="status"
              className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-200 bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-900/30 px-3 py-2 rounded-xl"
            >
              <p className="flex-1">
                {t("login.forgotPasswordHelp")}
              </p>
              <button
                type="button"
                onClick={() => setShowForgot(false)}
                aria-label={t("common.closeMessage")}
                className="shrink-0 p-1 -m-1 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {isRegister && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("login.confirmPassword")}
              </label>
              <input
                type="password"
                required
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                value={form.passwordConfirm}
                onChange={(e) => setForm({ ...form, passwordConfirm: e.target.value })}
                disabled={loading}
              />
            </div>
          )}

          {error && (
            <div className="text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 px-3 py-2 rounded-xl">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-xl transition-colors shadow-sm mt-4"
          >
            {loading
              ? isRegister
                ? t("login.registering")
                : t("login.loggingIn")
              : isRegister
                ? t("login.register")
                : t("login.login")}
          </button>
        </form>

        {(registrationEnabled || isRegister) && (
          <button
            type="button"
            onClick={toggleMode}
            disabled={loading}
            className="w-full text-center text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline mt-6 disabled:opacity-60"
          >
            {isRegister
              ? t("login.haveAccount")
              : t("login.noAccount")}
          </button>
        )}

        <button
          type="button"
          onClick={togglePolicy}
          aria-expanded={showPolicy}
          className="w-full text-center text-xs text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 hover:underline mt-3"
        >
          {t("login.policy")}
        </button>

        {showPolicy && (
          <div
            role="status"
            className="flex items-start gap-3 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700 px-3 py-2 rounded-xl mt-2"
          >
            <p className="flex-1">
              {t("login.policyText")}
            </p>
            <button
              type="button"
              onClick={() => setShowPolicy(false)}
              aria-label={t("common.closeMessage")}
              className="shrink-0 p-1 -m-1 rounded-lg text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
