import { useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, ArrowLeftRight, X, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiFetch, readJson } from "../../services/api";
import { formatCents, parseAmountToCents } from "../../utils/money";
import { currencySymbol, decimalSeparator, formatDate, formatMoney } from "../../utils/format";
import { errorMessage } from "../../utils/errors";
import PeriodSelector from "../ui/PeriodSelector";
import AccountSelector from "../ui/AccountSelector";
import TransferLabel from "./TransferLabel";

const EMPTY_EDIT_FORM = {
  date: "",
  amount: "",
  categoryName: "",
  description: "",
  accountId: "",
  toAccountId: "",
};

export default function TransactionList({ initialYear = null, initialMonth = null }) {
  const { t } = useTranslation();
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(initialYear || now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(initialMonth || now.getMonth() + 1);
  const [availableYears, setAvailableYears] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Categories: colors for the rows and options for the edit form.
  const [categories, setCategories] = useState([]);
  const categoryColors = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.name, c.color])),
    [categories],
  );

  // accountId "" = all accounts (default). With several accounts, each row
  // shows its account name while the view is aggregated.
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const accountsById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  // Edit bottom sheet
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
  // The row being edited; for a transfer, the sheet edits the whole pair.
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const editingTransfer = !!editTarget?.transferId;

  useEffect(() => {
    apiFetch("/api/categories")
      .then((res) => res.json())
      .then((data) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]));

    apiFetch("/api/accounts")
      .then((res) => res.json())
      .then((data) => setAccounts(Array.isArray(data) ? data : []))
      .catch(() => setAccounts([]));
  }, []);

  // Available years depend on the selected account.
  useEffect(() => {
    const accountParam = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
    apiFetch(`/api/transactions/years${accountParam}`)
      .then((res) => res.json())
      .then((years) => {
        const list = Array.isArray(years) ? years : [];
        setAvailableYears(list);
        setSelectedYear((prev) => (list.length > 0 && !list.includes(prev) ? list[0] : prev));
      })
      .catch(() => setAvailableYears([]));
  }, [accountId]);

  // Transactions of the selected month (and account), sorted by the server.
  useEffect(() => {
    const fetchTransactions = async () => {
      setLoading(true);
      try {
        const accountParam = accountId ? `&accountId=${encodeURIComponent(accountId)}` : "";
        const res = await apiFetch(
          `/api/transactions?year=${selectedYear}&month=${selectedMonth}${accountParam}`,
        );
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        // Across all accounts a transfer would show twice (one row per
        // account): only its outgoing row is kept, it reads "From A to B".
        setTransactions(accountId ? list : list.filter((t) => t.type !== "transfer_in"));
      } catch {
        setTransactions([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
  }, [selectedYear, selectedMonth, accountId, refreshTrigger]);

  // A transfer is deleted as a whole: both rows, from both accounts.
  const handleDelete = async (transaction) => {
    const isTransfer = !!transaction.transferId;
    if (!window.confirm(t(isTransfer ? "transfers.confirmDelete" : "transactions.confirmDelete")))
      return;

    try {
      const endpoint = isTransfer
        ? `/api/transfers/${transaction.transferId}`
        : `/api/transactions/${transaction.id}`;
      const res = await apiFetch(endpoint, { method: "DELETE" });
      if (res.ok) {
        setRefreshTrigger((n) => n + 1);
      } else {
        alert(
          errorMessage(
            await readJson(res),
            isTransfer ? "transfers.deleteFailed" : "transactions.deleteFailed",
          ),
        );
      }
    } catch {
      alert(t("errors.network"));
    }
  };

  const openEdit = (transaction) => {
    setEditError("");
    setEditTarget(transaction);
    // For a transfer, accountId is the source and toAccountId the target,
    // whichever of the two rows was opened.
    const isOut = transaction.type === "transfer_out";
    const ownAccount = String(transaction.accountId ?? accounts[0]?.id ?? "");
    const counterpart = String(transaction.counterpartAccountId ?? "");
    setEditForm({
      date: transaction.date,
      amount: formatCents(transaction.amountCents, decimalSeparator()),
      categoryName: transaction.categoryName ?? "",
      description: transaction.description || "",
      accountId: transaction.transferId && !isOut ? counterpart : ownAccount,
      toAccountId: transaction.transferId ? (isOut ? counterpart : ownAccount) : "",
    });
    setEditOpen(true);
  };

  const closeEdit = () => {
    if (editLoading) return;
    setEditOpen(false);
    setEditError("");
    setEditTarget(null);
  };

  const saveEdit = async () => {
    if (!editTarget) return;

    if (
      !editForm.date ||
      !editForm.amount ||
      (editingTransfer ? !editForm.toAccountId : !editForm.categoryName)
    ) {
      setEditError(t("errors.MISSING_FIELDS"));
      return;
    }
    if (editingTransfer && editForm.accountId === editForm.toAccountId) {
      setEditError(t("errors.SAME_ACCOUNT"));
      return;
    }

    const amountCents = parseAmountToCents(editForm.amount);
    if (amountCents === null) {
      setEditError(t("errors.INVALID_AMOUNT"));
      return;
    }

    setEditLoading(true);
    setEditError("");

    try {
      const res = editingTransfer
        ? await apiFetch(`/api/transfers/${editTarget.transferId}`, {
            method: "PUT",
            body: JSON.stringify({
              date: editForm.date,
              amountCents,
              fromAccountId: Number(editForm.accountId),
              toAccountId: Number(editForm.toAccountId),
              description: editForm.description,
            }),
          })
        : await apiFetch(`/api/transactions/${editTarget.id}`, {
            method: "PUT",
            body: JSON.stringify({
              date: editForm.date,
              amountCents,
              categoryName: editForm.categoryName,
              description: editForm.description,
              accountId: editForm.accountId ? Number(editForm.accountId) : undefined,
            }),
          });

      if (res.ok) {
        setEditOpen(false);
        setEditTarget(null);
        setRefreshTrigger((n) => n + 1);
      } else {
        setEditError(
          errorMessage(
            await readJson(res),
            editingTransfer ? "transfers.saveFailed" : "transactionForm.saveFailed",
          ),
        );
      }
    } catch {
      setEditError(t("errors.network"));
    } finally {
      setEditLoading(false);
    }
  };

  const deleteFromEdit = async () => {
    if (!editTarget) return;
    // Close first so the UI is never left half-way, then delete.
    const target = editTarget;
    closeEdit();
    await handleDelete(target);
  };

  // Income minus expenses, like the dashboard: transfers are neither.
  const monthlyNetCents = transactions.reduce(
    (sum, t) =>
      sum + (t.type === "income" ? t.amountCents : t.type === "expense" ? -t.amountCents : 0),
    0,
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-between">
          {/* Phones: two equal columns, always side by side */}
          <div
            className={`gap-2 sm:flex sm:flex-wrap sm:items-center ${
              accounts.length > 1 ? "grid grid-cols-2" : "flex"
            }`}
          >
            {accounts.length > 1 && (
              <AccountSelector
                accounts={accounts}
                accountId={accountId}
                onChange={setAccountId}
                containerClassName="min-w-0"
                className="w-full sm:w-auto"
              />
            )}
            <PeriodSelector
              className="min-w-0 w-full sm:w-auto"
              year={selectedYear}
              month={selectedMonth}
              onChange={({ year, month }) => {
                setSelectedYear(year);
                setSelectedMonth(month);
              }}
              availableYears={availableYears}
              accountId={accountId}
            />
          </div>

          <div className="flex gap-2 items-center justify-between sm:justify-end">
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-lg type-secondary flex items-center justify-center">
              {t("transactions.count", { count: transactions.length })}
            </span>
            <span
              className={`px-4 py-2 rounded-xl type-secondary font-bold tabular-nums flex items-center justify-center ${
                monthlyNetCents >= 0
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              }`}
            >
              {formatMoney(monthlyNetCents)}
            </span>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden shadow-sm">
        {loading ? (
          <p className="text-center py-12 text-gray-500 animate-pulse">{t("common.loading")}</p>
        ) : transactions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">{t("transactions.emptyMonth")}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {transactions.map((transaction) => {
              const categoryColor = categoryColors[transaction.categoryName] || "#6B7280";
              const isIncome = transaction.type === "income";
              const isTransfer = !!transaction.transferId;
              // Account name only in the aggregated view (no account filter)
              // and only with several accounts: otherwise it is redundant.
              const account = accountsById[transaction.accountId];
              const showAccount = !accountId && accounts.length > 1 && account;
              // The whole row opens the edit sheet: a large touch target
              // and no extra column for an edit button on narrow screens.
              return (
                <button
                  type="button"
                  key={transaction.id}
                  onClick={() => openEdit(transaction)}
                  className="w-full text-left p-4 flex items-start gap-3 hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-gray-700/50 dark:active:bg-gray-700 transition-colors"
                >
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      isTransfer
                        ? "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300"
                        : isIncome
                          ? "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400"
                          : "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
                    }`}
                  >
                    {isTransfer ? (
                      <ArrowLeftRight className="w-5 h-5" />
                    ) : isIncome ? (
                      <TrendingUp className="w-5 h-5" />
                    ) : (
                      <TrendingDown className="w-5 h-5" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="type-row-title text-gray-900 dark:text-white truncate">
                        {/* A transfer is titled "Transfer"; its description
                            goes on the third line. */}
                        {isTransfer
                          ? t("transfers.label")
                          : transaction.description || t("transactions.noDescription")}
                      </p>
                      {isTransfer ? (
                        // Wraps instead of truncating: both account names
                        // are the point of a transfer row.
                        <p className="type-secondary font-medium break-words mt-1 text-slate-500 dark:text-slate-400">
                          <TransferLabel transaction={transaction} accountsById={accountsById} />
                        </p>
                      ) : (
                        <p className="type-secondary font-medium truncate mt-1" style={{ color: categoryColor }}>
                          {transaction.categoryName}
                        </p>
                      )}
                      {/* A transfer shows its note where other rows show
                          their account (implied by "From A to B"). */}
                      {isTransfer
                        ? transaction.description && (
                            <p className="type-secondary text-gray-500 dark:text-gray-400 truncate mt-1">
                              {transaction.description}
                            </p>
                          )
                        : showAccount && (
                            <p className="type-secondary text-gray-500 dark:text-gray-400 truncate mt-1">
                              {account.name}
                            </p>
                          )}
                    </div>

                    <div className="flex flex-col items-end shrink-0 gap-1">
                      <p className="type-amount text-gray-900 dark:text-white">
                        {formatMoney(transaction.amountCents)}
                      </p>
                      <p className="type-secondary text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatDate(transaction.date)}
                      </p>
                    </div>
                  </div>

                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit bottom sheet */}
      {editOpen && (
        <>
          <button className="fixed inset-0 bg-black/40 z-40" onClick={closeEdit} aria-label={t("common.close")} />
          <div className="fixed left-0 right-0 bottom-0 z-50 sm:flex sm:justify-center">
            <div className="w-full sm:max-w-md bg-white dark:bg-gray-800 rounded-t-3xl sm:rounded-3xl border border-gray-200 dark:border-gray-700 shadow-2xl pt-4 px-4 sheet-panel">
              <div className="flex items-center justify-between mb-3">
                <h3 className="type-section text-gray-900 dark:text-white">
                  {t(editingTransfer ? "transfers.editTitle" : "transactions.editTitle")}
                </h3>
                <button
                  onClick={closeEdit}
                  className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  aria-label={t("common.close")}
                  disabled={editLoading}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {editError && (
                <div className="mb-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-100 dark:border-red-900/40 type-secondary">
                  {editError}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block type-label text-gray-500 dark:text-gray-400 mb-1">
                    {t("transactionForm.date")}
                  </label>
                  <input
                    type="date"
                    value={editForm.date}
                    onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 outline-none"
                  />
                </div>

                <div>
                  <label className="block type-label text-gray-500 dark:text-gray-400 mb-1">
                    {t("transactionForm.amount", { currency: currencySymbol() })}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={editForm.amount}
                    onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 outline-none"
                  />
                </div>

                {/* A transfer has a source and a target account and no
                    category; a transaction has one account and a category. */}
                {(editingTransfer
                  ? [
                      ["accountId", "transfers.from"],
                      ["toAccountId", "transfers.to"],
                    ]
                  : accounts.length > 1
                    ? [["accountId", "transactionForm.account"]]
                    : []
                ).map(([field, labelKey]) => (
                  <div key={field}>
                    <label className="block type-label text-gray-500 dark:text-gray-400 mb-1">
                      {t(labelKey)}
                    </label>
                    <select
                      value={editForm[field]}
                      onChange={(e) => setEditForm((f) => ({ ...f, [field]: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 outline-none"
                    >
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}

                {!editingTransfer && (
                  <div>
                    <label className="block type-label text-gray-500 dark:text-gray-400 mb-1">
                      {t("transactionForm.category")}
                    </label>
                    <select
                      value={editForm.categoryName}
                      onChange={(e) => setEditForm((f) => ({ ...f, categoryName: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 outline-none"
                      disabled={categories.length === 0}
                    >
                      {categories.map((category) => (
                        <option key={category.id} value={category.name}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block type-label text-gray-500 dark:text-gray-400 mb-1">
                    {t("transactionForm.description")}
                  </label>
                  <input
                    type="text"
                    maxLength={200}
                    value={editForm.description}
                    onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 outline-none"
                    placeholder={t(editingTransfer ? "transfers.descriptionPlaceholder" : "transactionForm.descriptionPlaceholder")}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={closeEdit}
                    className="py-3 rounded-2xl border border-gray-200 dark:border-gray-700 font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
                    disabled={editLoading}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={saveEdit}
                    className="py-3 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-semibold transition-colors disabled:opacity-50"
                    disabled={editLoading}
                  >
                    {editLoading ? t("common.saving") : t("common.save")}
                  </button>
                </div>

                <button
                  onClick={deleteFromEdit}
                  disabled={editLoading}
                  className="w-full mt-2 py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-5 h-5" /> {t("common.delete")}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
