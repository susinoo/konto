import { useState, useEffect, useMemo } from "react";
import { Save, ArrowLeftRight, ReceiptText, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiFetch, readJson } from "../../services/api";
import { parseAmountToCents } from "../../utils/money";
import { currencySymbol, todayIso } from "../../utils/format";
import { errorMessage } from "../../utils/errors";

const INITIAL_FORM = {
  date: "",
  amount: "",
  categoryName: "",
  description: "",
  accountId: "",
  toAccountId: "",
};

const SELECT_CLASS =
  "w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none";

// `onClose` adds a close button (mobile, where there are no list/new tabs).
export default function TransactionForm({ onTransactionAdded, onClose }) {
  const { t } = useTranslation();
  // New entries default to today: on a phone they are usually recorded on
  // the spot.
  const [form, setForm] = useState(() => ({ ...INITIAL_FORM, date: todayIso() }));
  // "transaction" (income/expense, typed by its category) or "transfer"
  // between two of the user's accounts.
  const [kind, setKind] = useState("transaction");
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });

  useEffect(() => {
    apiFetch("/api/categories")
      .then((res) => res.json())
      .then((data) => {
        if (data?.length > 0) {
          setCategories(data);
          setForm((prev) => (prev.categoryName ? prev : { ...prev, categoryName: data[0].name }));
        }
      })
      .catch((err) => console.error("Failed to load categories:", err));

    apiFetch("/api/accounts")
      .then((res) => res.json())
      .then((data) => {
        if (data?.length > 0) {
          setAccounts(data);
          const defaultAccount = data.find((a) => a.isDefault) || data[0];
          const otherAccount = data.find((a) => a.id !== defaultAccount.id);
          setForm((prev) =>
            prev.accountId
              ? prev
              : {
                  ...prev,
                  accountId: String(defaultAccount.id),
                  toAccountId: otherAccount ? String(otherAccount.id) : "",
                },
          );
        }
      })
      .catch((err) => console.error("Failed to load accounts:", err));
  }, []);

  const selectedCategoryColor = useMemo(() => {
    const category = categories.find((c) => c.name === form.categoryName);
    return category ? category.color : "#6B7280";
  }, [categories, form.categoryName]);

  const isTransfer = kind === "transfer";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.date || !form.amount) return;
    if (isTransfer ? !form.toAccountId : !form.categoryName) return;
    if (isTransfer && form.accountId === form.toAccountId) {
      setMessage({ text: t("errors.SAME_ACCOUNT"), type: "error" });
      return;
    }

    const amountCents = parseAmountToCents(form.amount);
    if (amountCents === null) {
      setMessage({ text: t("errors.INVALID_AMOUNT"), type: "error" });
      return;
    }

    setLoading(true);
    setMessage({ text: "", type: "" });

    try {
      const res = isTransfer
        ? await apiFetch("/api/transfers", {
            method: "POST",
            body: JSON.stringify({
              date: form.date,
              amountCents,
              fromAccountId: Number(form.accountId),
              toAccountId: Number(form.toAccountId),
              description: form.description,
            }),
          })
        : await apiFetch("/api/transactions", {
            method: "POST",
            body: JSON.stringify({
              date: form.date,
              amountCents,
              categoryName: form.categoryName,
              description: form.description,
              accountId: form.accountId ? Number(form.accountId) : undefined,
            }),
          });
      const result = await readJson(res);

      if (res.ok) {
        setMessage({
          text: t(isTransfer ? "transfers.saved" : "transactionForm.saved"),
          type: "success",
        });
        if (onTransactionAdded) onTransactionAdded();

        setForm({
          ...INITIAL_FORM,
          date: form.date,
          categoryName: form.categoryName,
          accountId: form.accountId,
          toAccountId: form.toAccountId,
        });
        setTimeout(() => setMessage({ text: "", type: "" }), 3000);
      } else {
        setMessage({
          text: errorMessage(result, isTransfer ? "transfers.saveFailed" : "transactionForm.saveFailed"),
          type: "error",
        });
      }
    } catch {
      setMessage({ text: t("errors.network"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="type-section text-gray-900 dark:text-white">
          {t("transactionForm.title")}
        </h3>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="sm:hidden p-2 -m-2 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label={t("common.close")}
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {message.text && (
        <div
          className={`p-3 rounded-xl mb-4 type-secondary font-medium ${message.type === "success" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Transfers need at least two accounts */}
        {accounts.length > 1 && (
          <div className="flex bg-gray-100 dark:bg-gray-900 rounded-xl p-1 shadow-inner">
            {[
              ["transaction", ReceiptText, "transactionForm.kindTransaction"],
              ["transfer", ArrowLeftRight, "transactionForm.kindTransfer"],
            ].map(([value, Icon, labelKey]) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                aria-pressed={kind === value}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg type-label transition-all ${
                  kind === value
                    ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm ring-1 ring-gray-200 dark:ring-gray-700"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                <Icon className="w-4 h-4" /> {t(labelKey)}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
          <div className="min-w-0">
            <label className="block type-label text-gray-700 dark:text-gray-300 mb-1">
              {t("transactionForm.date")}
            </label>
            <input
              type="date"
              required
              className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div className="min-w-0">
            <label className="block type-label text-gray-700 dark:text-gray-300 mb-1">
              {t("transactionForm.amount", { currency: currencySymbol() })}
            </label>
            {/* Text + decimal keyboard rather than type="number": iOS then
                offers the decimal key of the user's locale (a comma in
                Italian), which parseAmountToCents accepts. */}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              required
              className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
        </div>

        {isTransfer ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
            {[
              ["accountId", "transfers.from"],
              ["toAccountId", "transfers.to"],
            ].map(([field, labelKey]) => (
              <div key={field} className="min-w-0">
                <label className="block type-label text-gray-700 dark:text-gray-300 mb-1">
                  {t(labelKey)}
                </label>
                <select
                  required
                  className={SELECT_CLASS}
                  value={form[field]}
                  onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        ) : (
          accounts.length > 1 && (
            <div>
              <label className="block type-label text-gray-700 dark:text-gray-300 mb-1">
                {t("transactionForm.account")}
              </label>
              <select
                required
                className={SELECT_CLASS}
                value={form.accountId}
                onChange={(e) => setForm({ ...form, accountId: e.target.value })}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
          )
        )}

        {!isTransfer && (
          <div>
            <label className="block type-label text-gray-700 dark:text-gray-300 mb-1">
              {t("transactionForm.category")}
            </label>
            <div className="relative flex items-center">
              {/* Category color dot */}
              <div
                className="absolute left-3 w-3 h-3 rounded-full shadow-inner z-10 pointer-events-none"
                style={{ backgroundColor: selectedCategoryColor }}
              />
              <select
                required
                className="w-full pl-9 pr-10 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none appearance-none"
                value={form.categoryName}
                onChange={(e) => setForm({ ...form, categoryName: e.target.value })}
                disabled={categories.length === 0}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.name}>
                    {category.name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                <svg
                  className="fill-current h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                </svg>
              </div>
            </div>
          </div>
        )}

        <div>
          <label className="block type-label text-gray-700 dark:text-gray-300 mb-1">
            {t("transactionForm.description")}
          </label>
          <input
            type="text"
            placeholder={t(isTransfer ? "transfers.descriptionPlaceholder" : "transactionForm.descriptionPlaceholder")}
            className="w-full px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
            maxLength={200}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex justify-center items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 px-4 rounded-xl transition-colors mt-2 disabled:opacity-50"
        >
          <Save className="w-5 h-5" />{" "}
          {loading
            ? t("common.saving")
            : t(isTransfer ? "transfers.submit" : "transactionForm.submit")}
        </button>
      </form>
    </div>
  );
}
