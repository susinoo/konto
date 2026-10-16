import { useState } from "react";
import {
  LogOut,
  KeyRound,
  Trash2,
  Download,
  Database,
  Languages,
} from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { apiFetch, readJson } from "../services/api";
import { errorMessage } from "../utils/errors";
import { SUPPORTED_LANGUAGES } from "../i18n";
import CategoryManager from "../components/categories/CategoryManager";
import AccountManager from "../components/accounts/AccountManager";

const EMPTY_PASSWORD_FORM = {
  currentPassword: "",
  newPassword: "",
  newPasswordConfirm: "",
};

export default function Settings({ user, setAuth }) {
  const { t, i18n } = useTranslation();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD_FORM);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const handleLogout = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Log out in the UI even if the request fails
    } finally {
      setAuth(false);
    }
  };

  const togglePasswordForm = () => {
    setShowPasswordForm((prev) => !prev);
    setPasswordForm(EMPTY_PASSWORD_FORM);
    setPasswordError("");
    setPasswordSuccess("");
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (
      !passwordForm.currentPassword ||
      !passwordForm.newPassword ||
      !passwordForm.newPasswordConfirm
    )
      return;
    if (passwordForm.newPassword !== passwordForm.newPasswordConfirm) {
      setPasswordError(t("errors.PASSWORDS_DO_NOT_MATCH"));
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await apiFetch("/api/account/change-password", {
        method: "POST",
        body: JSON.stringify(passwordForm),
      });

      if (!res.ok) {
        setPasswordError(errorMessage(await readJson(res), "settings.passwordFailed"));
        return;
      }

      setPasswordForm(EMPTY_PASSWORD_FORM);
      setPasswordSuccess(t("settings.passwordChanged"));
    } catch (err) {
      if (String(err?.message || "") === "NOT_AUTHORIZED") {
        setAuth(false);
      } else {
        setPasswordError(t("errors.network"));
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  const toggleDeleteForm = () => {
    setShowDeleteForm((prev) => !prev);
    setDeletePassword("");
    setDeleteError("");
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    setDeleteError("");

    if (!deletePassword) return;

    setDeleteLoading(true);
    try {
      const res = await apiFetch("/api/account/delete", {
        method: "POST",
        body: JSON.stringify({ currentPassword: deletePassword }),
      });

      if (!res.ok) {
        setDeleteError(errorMessage(await readJson(res), "settings.deleteFailed"));
        return;
      }

      setAuth(false);
    } catch (err) {
      if (String(err?.message || "") === "NOT_AUTHORIZED") {
        setAuth(false);
      } else {
        setDeleteError(t("errors.network"));
      }
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleExportCsv = () => {
    // The CSV format (separator, decimal mark, headers) follows the UI language.
    window.open(
      `/api/export/transactions.csv?locale=${i18n.resolvedLanguage}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleExportDb = () => {
    window.open("/api/export/database", "_blank", "noopener,noreferrer");
  };

  return (
    <div className="p-4 sm:p-6 animate-in fade-in duration-300 space-y-6">
      {/* Accounts */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="type-section text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-2">
          {t("settings.accountsTitle")}
        </h2>
        <p className="mt-2 mb-4 type-caption text-gray-400 dark:text-gray-500">
          {t("settings.accountsHint")}
        </p>

        <AccountManager />
      </div>

      {/* Categories */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="type-section text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-2">
          {t("settings.categoriesTitle")}
        </h2>
        <p className="mt-2 mb-4 type-caption text-gray-400 dark:text-gray-500">
          {t("settings.categoriesHint")}
        </p>

        <CategoryManager />
      </div>

      {/* Profile: language, change password, log out */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="type-section mb-4 text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-2">
          {t("settings.accountTitle")}
        </h2>

        <div className="flex flex-col sm:flex-row gap-3">
          {/* Styled like the buttons next to it */}
          <label className="flex items-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 dark:bg-gray-700/50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl transition-colors font-medium w-full sm:w-auto justify-center cursor-pointer">
            <Languages className="w-5 h-5 shrink-0" />
            <span className="sr-only">{t("settings.languageTitle")}</span>
            <select
              value={i18n.resolvedLanguage}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="bg-transparent outline-none cursor-pointer font-medium"
            >
              {SUPPORTED_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={togglePasswordForm}
            className="flex items-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 dark:bg-gray-700/50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl transition-colors font-medium w-full sm:w-auto justify-center"
          >
            <KeyRound className="w-5 h-5" />
            {t("settings.changePassword")}
          </button>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded-xl transition-colors font-medium w-full sm:w-auto justify-center"
          >
            <LogOut className="w-5 h-5" />
            {t("settings.logout")}
          </button>
        </div>

        {showPasswordForm && (
          <form
            onSubmit={handleChangePassword}
            className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 space-y-3"
          >
            <div>
              <label className="block type-label text-gray-700 dark:text-gray-300 mb-1">
                {t("settings.currentPassword")}
              </label>
              <input
                type="password"
                required
                className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                value={passwordForm.currentPassword}
                onChange={(e) =>
                  setPasswordForm({ ...passwordForm, currentPassword: e.target.value })
                }
                disabled={passwordLoading}
              />
            </div>

            <div>
              <label className="block type-label text-gray-700 dark:text-gray-300 mb-1">
                {t("settings.newPassword")}
              </label>
              <input
                type="password"
                required
                minLength={8}
                className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                value={passwordForm.newPassword}
                onChange={(e) =>
                  setPasswordForm({ ...passwordForm, newPassword: e.target.value })
                }
                disabled={passwordLoading}
              />
            </div>

            <div>
              <label className="block type-label text-gray-700 dark:text-gray-300 mb-1">
                {t("settings.confirmNewPassword")}
              </label>
              <input
                type="password"
                required
                minLength={8}
                className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                value={passwordForm.newPasswordConfirm}
                onChange={(e) =>
                  setPasswordForm({ ...passwordForm, newPasswordConfirm: e.target.value })
                }
                disabled={passwordLoading}
              />
            </div>

            {passwordError && (
              <div className="type-secondary font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 px-3 py-2 rounded-xl">
                {passwordError}
              </div>
            )}

            {passwordSuccess && (
              <div className="type-secondary font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/30 px-3 py-2 rounded-xl">
                {passwordSuccess}
              </div>
            )}

            <button
              type="submit"
              disabled={passwordLoading}
              className="w-full sm:w-auto bg-primary-600 hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-xl transition-colors"
            >
              {passwordLoading ? t("common.saving") : t("settings.saveNewPassword")}
            </button>
          </form>
        )}
      </div>

      {/* Backup */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="type-section mb-4 text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-2">
          {t("settings.backupTitle")}
        </h2>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleExportCsv}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-semibold transition-colors"
          >
            <Download className="w-5 h-5" />
            {t("settings.downloadCsv")}
          </button>

          {user?.isOwner && (
            <button
              onClick={handleExportDb}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gray-900 hover:bg-black text-white font-semibold transition-colors dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              <Database className="w-5 h-5" />
              {t("settings.downloadDb")}
            </button>
          )}
        </div>
      </div>

      {/* Delete account and data */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-6 shadow-sm border border-red-200 dark:border-red-900/50">
        <h2 className="type-section mb-4 text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-2">
          {t("settings.deleteTitle")}
        </h2>

        <p className="type-secondary text-red-600 dark:text-red-400 mb-4">
          <Trans i18nKey="settings.deleteWarning" components={{ em: <span className="underline" /> }} />
        </p>

        {!showDeleteForm ? (
          <button
            onClick={toggleDeleteForm}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded-xl transition-colors font-medium w-full sm:w-auto justify-center"
          >
            <Trash2 className="w-5 h-5" />
            {t("settings.deleteTitle")}
          </button>
        ) : (
          <form
            onSubmit={handleDeleteAccount}
            className="pt-2 border-t border-red-100 dark:border-red-900/30 space-y-3"
          >
            <div className="type-secondary font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 px-3 py-2 rounded-xl">
              {t("settings.deleteConfirmText")}
            </div>

            <div>
              <label className="block type-label text-gray-700 dark:text-gray-300 mb-1">
                {t("settings.currentPassword")}
              </label>
              <input
                type="password"
                required
                className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 outline-none"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                disabled={deleteLoading}
              />
            </div>

            {deleteError && (
              <div className="type-secondary font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 px-3 py-2 rounded-xl">
                {deleteError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="submit"
                disabled={deleteLoading}
                className="w-full sm:w-auto bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-xl transition-colors"
              >
                {deleteLoading ? t("settings.deleting") : t("settings.confirmDelete")}
              </button>
              <button
                type="button"
                onClick={toggleDeleteForm}
                disabled={deleteLoading}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 dark:bg-gray-700/50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium transition-colors disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
