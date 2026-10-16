import { useEffect, useMemo, useState } from "react";
import { ChevronDown, TrendingUp, TrendingDown, Scale, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../services/api";
import { formatDate, formatMoney } from "../utils/format";
import PeriodSelector from "../components/ui/PeriodSelector";
import TransferLabel from "../components/transactions/TransferLabel";

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

export default function Dashboard() {
  const { t } = useTranslation();
  const now = new Date();

  // Active period (month 1-12)
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [availableYears, setAvailableYears] = useState([]);

  // Selected account: null until the user picks one, so the backend falls
  // back to the default account. Once picked, it stays explicit across
  // period changes.
  const [accountId, setAccountId] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const [summary, setSummary] = useState(null);
  const [recent, setRecent] = useState([]);
  const [categoryColors, setCategoryColors] = useState({});
  const accountsById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a])),
    [accounts],
  );
  const [expenseBreakdown, setExpenseBreakdown] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // All dashboard data in one aggregated round trip (/api/dashboard).
  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError("");

      try {
        const accountParam = accountId ? `&accountId=${accountId}` : "";
        const res = await apiFetch(`/api/dashboard?year=${year}&month=${month}${accountParam}`);
        const data = await res.json();

        const years = Array.isArray(data.years) ? data.years : [];
        setAvailableYears(years);
        if (years.length > 0 && !years.includes(year)) {
          // No data in the current year: jump to the most recent one; the
          // effect runs again with the new year.
          setYear(years[0]);
          return;
        }

        setCategoryColors(Object.fromEntries((data.categories || []).map((c) => [c.name, c.color])));
        setSummary(data.summary || null);
        setRecent(Array.isArray(data.recent) ? data.recent : []);
        setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
        setActiveAccount(data.activeAccount || null);

        // The card shows how expenses are split: income categories are left out.
        setExpenseBreakdown(
          (Array.isArray(data.breakdown) ? data.breakdown : [])
            .filter((row) => row.type === "expense")
            .sort((a, b) => b.totalCents - a.totalCents),
        );
      } catch {
        // Stores the translation key: the message follows language changes.
        setError("dashboard.loadFailed");
        setSummary(null);
        setRecent([]);
        setExpenseBreakdown([]);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [year, month, accountId]);

  const selectAccount = (id) => {
    setAccountId(id);
    setAccountMenuOpen(false);
  };

  const totalExpensesCents = useMemo(() => {
    if (summary) return Math.max(0, summary.expensesCents);
    return expenseBreakdown.reduce((sum, row) => sum + row.totalCents, 0);
  }, [summary, expenseBreakdown]);

  return (
    <div className="p-4 sm:p-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="relative min-w-0">
          <button
            type="button"
            onClick={() => setAccountMenuOpen((prev) => !prev)}
            disabled={accounts.length === 0}
            aria-expanded={accountMenuOpen}
            className="flex items-center gap-1.5 text-xl font-bold text-gray-900 dark:text-white max-w-full disabled:cursor-default"
          >
            <span className="truncate">
              {activeAccount?.name || t("nav.dashboard")}
            </span>
            {accounts.length > 1 && (
              <ChevronDown
                className={`w-5 h-5 shrink-0 text-gray-400 transition-transform ${accountMenuOpen ? "rotate-180" : ""}`}
              />
            )}
          </button>

          {/* Running account balance (opening balance + every transaction
              to date), independent of the selected period: that is why it
              sits next to the account name rather than among the period
              cards below. */}
          {loading ? (
            <div className="mt-1 h-6 w-24 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          ) : (
            <p
              className={`text-lg font-bold ${
                !activeAccount
                  ? "text-gray-900 dark:text-white"
                  : activeAccount.balanceCents >= 0
                    ? "text-green-700 dark:text-green-400"
                    : "text-red-700 dark:text-red-400"
              }`}
              title={t("dashboard.balanceHint")}
            >
              {!activeAccount ? "—" : formatMoney(activeAccount.balanceCents)}
            </p>
          )}

          {accountMenuOpen && accounts.length > 1 && (
            <>
              <button
                className="fixed inset-0 z-40"
                onClick={() => setAccountMenuOpen(false)}
                aria-label={t("common.close")}
              />
              <div className="absolute left-0 top-full mt-2 z-50 w-64 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-lg overflow-hidden">
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    onClick={() => selectAccount(account.id)}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                      activeAccount?.id === account.id
                        ? "bg-primary-50 dark:bg-primary-900/20"
                        : ""
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: account.color }}
                        aria-hidden="true"
                      />
                      <span className="type-row-title text-gray-900 dark:text-white truncate">
                        {account.name}
                      </span>
                    </span>
                    <span className="type-secondary font-medium text-gray-500 dark:text-gray-400 shrink-0">
                      {formatMoney(account.balanceCents)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mobile already has the global FAB in App.jsx: desktop only */}
          <Link
            to="/transactions?action=add"
            className="hidden sm:inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t("dashboard.newTransaction")}
          </Link>

          <PeriodSelector
            year={year}
            month={month}
            onChange={({ year: nextYear, month: nextMonth }) => {
              setYear(nextYear);
              setMonth(nextMonth);
            }}
            availableYears={availableYears}
            accountId={accountId}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-100 dark:border-red-900/40 text-sm">
          {t(error)}
        </div>
      )}

      {/* KPI: one card with three columns, so on a phone the whole summary
          fits in a single row instead of filling the first screen. */}
      <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm mb-5">
        {[
          {
            label: t("dashboard.income"),
            icon: <TrendingUp className="w-4 h-4 shrink-0 text-green-600 dark:text-green-400" />,
            cents: summary?.incomeCents,
            color: "text-gray-900 dark:text-white",
          },
          {
            label: t("dashboard.expenses"),
            icon: <TrendingDown className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />,
            cents: summary?.expensesCents,
            color: "text-gray-900 dark:text-white",
          },
          {
            label: t("dashboard.net"),
            hint: t("dashboard.netHint"),
            icon: <Scale className="w-4 h-4 shrink-0 text-primary-600 dark:text-primary-400" />,
            cents: summary?.netCents,
            color: !summary
              ? "text-gray-900 dark:text-white"
              : summary.netCents >= 0
                ? "text-green-700 dark:text-green-400"
                : "text-red-700 dark:text-red-400",
          },
        ].map(({ label, hint, icon, cents, color }) => (
          <div key={label} className="p-3 sm:p-4 min-w-0 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-1">
              <p className="type-caption font-semibold text-gray-500 dark:text-gray-400 leading-tight" title={hint}>
                {label}
              </p>
              {icon}
            </div>
            {loading ? (
              <div className="mt-2 h-6 w-full max-w-24 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            ) : (
              <p className={`mt-1.5 text-[17px] sm:text-2xl font-bold tabular-nums break-words ${color}`}>
                {!summary ? "—" : formatMoney(cents)}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Expenses by category */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden mb-5">
        <div className="p-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="type-section text-gray-900 dark:text-white">
              {t("dashboard.byCategory")}
            </h2>
          </div>
        </div>

        {loading ? (
          <div className="px-4 pb-4 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1 animate-pulse">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-gray-200 dark:bg-gray-700 shrink-0" />
                    <span className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" />
                  </div>
                  <span className="h-3 w-12 rounded bg-gray-200 dark:bg-gray-700 shrink-0" />
                </div>
                <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-gray-700" />
              </div>
            ))}
          </div>
        ) : expenseBreakdown.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
            {t("dashboard.byCategoryEmpty")}
          </div>
        ) : (
          <div className="px-4 pb-4 space-y-3">
            {expenseBreakdown.map((row) => {
              const color = categoryColors[row.categoryName] || "#6B7280";
              const pct = totalExpensesCents > 0 ? clamp01(row.totalCents / totalExpensesCents) : 0;

              return (
                <div key={row.categoryName} className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                        aria-hidden="true"
                      />
                      <span className="type-row-title text-gray-900 dark:text-white truncate">
                        {row.categoryName}
                      </span>
                      <span className="type-caption text-gray-500 dark:text-gray-400 shrink-0">
                        {Math.round(pct * 100)}%
                      </span>
                    </div>

                    <div className="type-amount text-gray-900 dark:text-white shrink-0">
                      {formatMoney(row.totalCents)}
                    </div>
                  </div>

                  <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round(pct * 100)}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Latest transactions */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="p-4 flex items-center justify-between">
          <div>
            <h2 className="type-section text-gray-900 dark:text-white">
              {t("dashboard.recent")}
            </h2>
          </div>

          <Link
            to={`/transactions?year=${year}&month=${month}`}
            className="type-label text-primary-600 dark:text-primary-400 hover:underline"
          >
            {t("dashboard.seeAll")}
          </Link>
        </div>

        {loading ? (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="p-4 flex items-center justify-between gap-3 animate-pulse"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3 w-32 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-2.5 w-20 rounded bg-gray-200 dark:bg-gray-700" />
                </div>
                <div className="h-3 w-14 rounded bg-gray-200 dark:bg-gray-700 shrink-0" />
              </div>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
            {t("dashboard.recentEmpty")}
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {recent.map((transaction) => {
              const isTransfer = !!transaction.transferId;
              return (
                <div
                  key={transaction.id}
                  className="p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="type-row-title text-gray-900 dark:text-white truncate">
                      {isTransfer ? t("transfers.label") : transaction.description || "—"}
                    </p>
                    {/* Category (or "From A to B") first, then the date; wraps
                        instead of truncating. */}
                    <p className="type-secondary text-gray-500 dark:text-gray-400 mt-0.5 break-words">
                      {isTransfer ? (
                        <span className="font-medium text-slate-500 dark:text-slate-400">
                          <TransferLabel transaction={transaction} accountsById={accountsById} />
                        </span>
                      ) : (
                        <span
                          className="font-medium"
                          style={{ color: categoryColors[transaction.categoryName] || "#6B7280" }}
                        >
                          {transaction.categoryName}
                        </span>
                      )}{" "}
                      • {formatDate(transaction.date)}
                    </p>
                  </div>

                  <div
                    className={`type-amount shrink-0 ${
                      isTransfer
                        ? "text-slate-600 dark:text-slate-300"
                        : transaction.type === "income"
                          ? "text-green-700 dark:text-green-400"
                          : "text-red-700 dark:text-red-400"
                    }`}
                  >
                    {formatMoney(transaction.amountCents)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
