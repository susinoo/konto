import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Star, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiFetch, readJson } from "../../services/api";
import { formatCents, parseAmountToCents } from "../../utils/money";
import { formatMoney } from "../../utils/format";
import { errorMessage } from "../../utils/errors";

// Account management (add, rename, recolor, edit opening balance, delete),
// same pattern as CategoryManager. The balance shown is computed by the
// backend (opening balance + transactions to date) and cannot be edited
// directly: only the opening balance can.
export default function AccountManager() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3B82F6");
  const [newOpeningBalance, setNewOpeningBalance] = useState("");
  const [loading, setLoading] = useState(false);
  // The "new account" form stays folded behind a button: the list comes
  // first on a phone.
  const [addOpen, setAddOpen] = useState(false);

  const [editingNameId, setEditingNameId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editingBalanceId, setEditingBalanceId] = useState(null);
  const [editOpeningBalance, setEditOpeningBalance] = useState("");

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await apiFetch("/api/accounts");
      setAccounts(await res.json());
    } catch (err) {
      console.error("Failed to load accounts:", err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAccounts();
  }, [fetchAccounts]);

  // PATCH helper: on failure shows the error and reloads the list.
  const updateAccount = async (id, fields, fallbackKey) => {
    try {
      const res = await apiFetch(`/api/accounts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        alert(errorMessage(await readJson(res), fallbackKey));
        fetchAccounts();
        return false;
      }
      return true;
    } catch {
      alert(t("errors.network"));
      fetchAccounts();
      return false;
    }
  };

  const handleAddAccount = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const openingBalanceCents =
      newOpeningBalance === "" ? 0 : parseAmountToCents(newOpeningBalance, { allowNegative: true });
    if (openingBalanceCents === null) {
      alert(t("errors.INVALID_OPENING_BALANCE"));
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch("/api/accounts", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), color: newColor, openingBalanceCents }),
      });

      if (res.ok) {
        setNewName("");
        setNewOpeningBalance("");
        setAddOpen(false);
        fetchAccounts();
      } else {
        alert(errorMessage(await readJson(res), "accounts.addFailed"));
      }
    } catch {
      alert(t("errors.network"));
    } finally {
      setLoading(false);
    }
  };

  const handleColorChange = (id, color) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, color } : a)));
    updateAccount(id, { color }, "accounts.colorFailed");
  };

  const handleSetDefault = (id) => {
    setAccounts((prev) => prev.map((a) => ({ ...a, isDefault: a.id === id })));
    updateAccount(id, { isDefault: true }, "accounts.setDefaultFailed");
  };

  const startEditName = (account) => {
    setEditingNameId(account.id);
    setEditName(account.name);
  };

  const saveName = async (id) => {
    setEditingNameId(null);
    const name = editName.trim();
    if (name) await updateAccount(id, { name }, "accounts.renameFailed");
    fetchAccounts();
  };

  const startEditOpeningBalance = (account) => {
    setEditingBalanceId(account.id);
    setEditOpeningBalance(formatCents(account.openingBalanceCents));
  };

  const saveOpeningBalance = async (id) => {
    setEditingBalanceId(null);
    const openingBalanceCents = parseAmountToCents(editOpeningBalance, { allowNegative: true });
    if (openingBalanceCents !== null) {
      await updateAccount(id, { openingBalanceCents }, "accounts.openingBalanceFailed");
    }
    fetchAccounts();
  };

  const handleDeleteAccount = async (id, name) => {
    if (!window.confirm(t("accounts.confirmDelete", { name }))) return;

    try {
      const res = await apiFetch(`/api/accounts/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchAccounts();
      } else {
        alert(errorMessage(await readJson(res), "accounts.deleteFailed"));
      }
    } catch {
      alert(t("errors.network"));
    }
  };

  return (
    <>
      {addOpen ? (
        <form onSubmit={handleAddAccount} className="flex flex-wrap gap-3 mb-4 items-end p-3 rounded-xl border border-gray-200 dark:border-gray-600">
          <div className="basis-full">
            <label className="block type-label text-gray-500 dark:text-gray-400 mb-1">
              {t("accounts.new")}
            </label>
            <input
              type="text"
              maxLength={50}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("accounts.newPlaceholder")}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:border-primary-500"
              required
            />
          </div>

          <div className="w-32">
            <label className="block type-label text-gray-500 dark:text-gray-400 mb-1">
              {t("accounts.openingBalance")}
            </label>
            <input
              type="number"
              step="0.01"
              value={newOpeningBalance}
              onChange={(e) => setNewOpeningBalance(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:border-primary-500"
            />
          </div>

          <div>
            <label className="block type-label text-gray-500 dark:text-gray-400 mb-1">
              {t("common.color")}
            </label>
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-10 w-10 rounded-full border border-gray-300 dark:border-gray-600 cursor-pointer p-0.5 bg-gray-50 dark:bg-gray-700"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="h-10 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> {t("common.add")}
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(false)}
            className="h-10 w-10 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label={t("common.cancel")}
          >
            <X className="w-5 h-5" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="mb-4 h-10 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium flex items-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" /> {t("accounts.new")}
        </button>
      )}

      <div className="space-y-2">
        {accounts.map((account) => (
          // Two lines: name (wraps, never truncated) and balance · opening
          // balance underneath, so long names fit on a phone.
          <div
            key={account.id}
            className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600"
          >
            <button
              type="button"
              onClick={() => !account.isDefault && handleSetDefault(account.id)}
              className={`p-1.5 -m-0.5 rounded-lg shrink-0 transition-colors ${
                account.isDefault
                  ? "text-amber-500 cursor-default"
                  : "text-gray-300 dark:text-gray-600 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20"
              }`}
              title={account.isDefault ? t("accounts.default") : t("accounts.makeDefault")}
              aria-label={
                account.isDefault
                  ? t("accounts.isDefaultLabel", { name: account.name })
                  : t("accounts.makeDefaultLabel", { name: account.name })
              }
            >
              <Star className={`w-5 h-5 ${account.isDefault ? "fill-amber-400" : ""}`} />
            </button>

            <input
              type="color"
              value={account.color}
              onChange={(e) => handleColorChange(account.id, e.target.value)}
              className="w-7 h-7 rounded-full border border-gray-200 dark:border-gray-600 cursor-pointer p-0 shrink-0"
              title={t("common.changeColor")}
              aria-label={t("accounts.colorOf", { name: account.name })}
            />

            <div className="min-w-0 flex-1">
              {editingNameId === account.id ? (
                <input
                  type="text"
                  maxLength={50}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => saveName(account.id)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  autoFocus
                  className="w-full px-2 py-1 rounded-lg border border-primary-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEditName(account)}
                  className="block max-w-full type-row-title text-gray-800 dark:text-gray-100 break-words text-left hover:underline"
                  title={t("common.rename")}
                >
                  {account.name}
                </button>
              )}

              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className={`type-secondary font-bold tabular-nums ${
                    account.balanceCents >= 0
                      ? "text-green-700 dark:text-green-400"
                      : "text-red-700 dark:text-red-400"
                  }`}
                >
                  {formatMoney(account.balanceCents)}
                </span>
                {editingBalanceId === account.id ? (
                  <input
                    type="number"
                    step="0.01"
                    value={editOpeningBalance}
                    onChange={(e) => setEditOpeningBalance(e.target.value)}
                    onBlur={() => saveOpeningBalance(account.id)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    autoFocus
                    className="w-28 px-1.5 py-0.5 type-secondary rounded-lg border border-primary-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => startEditOpeningBalance(account)}
                    className="type-caption text-gray-500 dark:text-gray-400 hover:underline"
                    title={t("accounts.editOpeningBalance")}
                  >
                    {t("accounts.openingShort", { amount: formatMoney(account.openingBalanceCents) })}
                  </button>
                )}
              </div>
            </div>

            <button
              onClick={() => handleDeleteAccount(account.id, account.name)}
              className="p-2 -m-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors shrink-0"
              title={t("common.delete")}
              aria-label={t("common.delete")}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
