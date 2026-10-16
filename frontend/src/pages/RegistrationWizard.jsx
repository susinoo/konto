import { useEffect, useState } from "react";
import { Sparkles, Wallet, PlusCircle, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiFetch, readJson } from "../services/api";
import { parseAmountToCents } from "../utils/money";
import { errorMessage } from "../utils/errors";
import CategoryManager from "../components/categories/CategoryManager";

const STEP_ACCOUNT = "account";
const STEP_CATEGORIES = "categories";
const STEP_CHOICE = "choice";

// Shown once, right after registration:
// 1) name the first account (+ opening balance)
// 2) customize the shared categories (the usual CategoryManager)
// 3) add another account (back to step 1) or enter the app.
// The same operations stay available in Settings.
export default function RegistrationWizard({ onDone }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(STEP_ACCOUNT);

  // The first account already exists (created at registration by
  // seedDefaultAccount in backend/db.js): this step renames it instead of
  // creating a new one, so the app stays usable even if the wizard is
  // abandoned half-way.
  const [isFirstAccount, setIsFirstAccount] = useState(true);
  const [accountId, setAccountId] = useState(null);

  const [name, setName] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [createdAccounts, setCreatedAccounts] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/accounts")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setAccountId(data[0].id);
      })
      // On failure, submitting creates a new account (POST) instead of
      // renaming the bootstrap one.
      .catch(() => {});
  }, []);

  const submitAccount = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    const openingBalanceCents =
      openingBalance === "" ? 0 : parseAmountToCents(openingBalance, { allowNegative: true });
    if (openingBalanceCents === null) {
      setError(t("errors.INVALID_OPENING_BALANCE"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res =
        isFirstAccount && accountId
          ? await apiFetch(`/api/accounts/${accountId}`, {
              method: "PATCH",
              body: JSON.stringify({ name: name.trim(), openingBalanceCents }),
            })
          : await apiFetch("/api/accounts", {
              method: "POST",
              body: JSON.stringify({ name: name.trim(), color: "#3B82F6", openingBalanceCents }),
            });

      const data = await readJson(res);
      if (!res.ok) {
        setError(errorMessage(data, "wizard.saveAccountFailed"));
        return;
      }

      setCreatedAccounts((prev) => [...prev, data.account.name]);
      setAccountId(data.account.id);
      setStep(STEP_CATEGORIES);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  };

  const addAnotherAccount = () => {
    setIsFirstAccount(false);
    setAccountId(null);
    setName("");
    setOpeningBalance("");
    setError("");
    setStep(STEP_ACCOUNT);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 transition-colors">
      <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 border border-gray-100 dark:border-gray-700">
        {step === STEP_ACCOUNT && (
          <>
            <div className="flex flex-col items-center text-center mb-6">
              <div className="bg-primary-100 dark:bg-primary-900/30 p-3 rounded-full mb-4">
                <Wallet className="w-8 h-8 text-primary-600 dark:text-primary-400" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {isFirstAccount
                  ? t("wizard.firstAccountTitle")
                  : t("wizard.addAccount")}
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                {isFirstAccount
                  ? t("wizard.firstAccountText")
                  : t("wizard.nextAccountText")}
              </p>
            </div>

            <form onSubmit={submitAccount} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("wizard.accountName")}
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  maxLength={50}
                  placeholder={t("wizard.accountNamePlaceholder")}
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("wizard.openingBalance")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0"
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  disabled={loading}
                />
              </div>

              {error && (
                <div className="text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 px-3 py-2 rounded-xl">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition-colors shadow-sm"
              >
                {loading ? t("common.saving") : t("common.continue")}
              </button>
            </form>
          </>
        )}

        {step === STEP_CATEGORIES && (
          <>
            <div className="flex flex-col items-center text-center mb-6">
              <div className="bg-primary-100 dark:bg-primary-900/30 p-3 rounded-full mb-4">
                <Sparkles className="w-8 h-8 text-primary-600 dark:text-primary-400" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {t("wizard.categoriesTitle")}
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                {t("wizard.categoriesText")}
              </p>
            </div>

            <CategoryManager />

            <button
              onClick={() => setStep(STEP_CHOICE)}
              className="w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 px-4 rounded-xl transition-colors shadow-sm mt-6"
            >
              {t("common.continue")}
            </button>
          </>
        )}

        {step === STEP_CHOICE && (
          <>
            <div className="flex flex-col items-center text-center mb-6">
              <div className="bg-primary-100 dark:bg-primary-900/30 p-3 rounded-full mb-4">
                <Check className="w-8 h-8 text-primary-600 dark:text-primary-400" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {t("wizard.doneTitle")}
              </h1>
              {createdAccounts.length > 0 && (
                <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                  {t("wizard.accountsSoFar", { names: createdAccounts.join(", ") })}
                </p>
              )}
              <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                {t("wizard.doneText")}
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={addAnotherAccount}
                className="w-full flex items-center justify-center gap-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-semibold py-3 px-4 rounded-xl transition-colors"
              >
                <PlusCircle className="w-5 h-5" />
                {t("wizard.addAccount")}
              </button>

              <button
                onClick={onDone}
                className="w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 px-4 rounded-xl transition-colors shadow-sm"
              >
                {t("wizard.finish")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
