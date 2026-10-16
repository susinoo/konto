import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Scale,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../services/api";
import { formatMoney, monthName } from "../utils/format";
import PeriodSelector from "../components/ui/PeriodSelector";
import AccountSelector from "../components/ui/AccountSelector";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// Analytics shows whole currency units: the yearly view is about trends,
// not cents.
const formatWhole = (cents) => formatMoney(cents, { wholeUnits: true });

// Chart values are in currency units (cents / 100).
function formatAxisValue(value) {
  return formatWhole(Math.round(Number(value) || 0) * 100);
}

// Y-axis maximum: ~10% headroom above the highest value, rounded up to the
// next hundred (1800 → 2000, 2200 → 2500), so bars never touch the top edge.
function niceAxisMax(maxValue) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 100;
  return Math.ceil((maxValue * 1.1) / 100) * 100;
}

// One row per month (1-12), including months without data. Amounts stay in
// cents; `income`/`expenses` are the currency-unit values plotted by the
// chart. Month labels are computed at render time, so they follow the
// language.
function buildMonthlyRows(monthly, monthlyByCategory) {
  const byMonth = new Map((Array.isArray(monthly) ? monthly : []).map((row) => [row.month, row]));

  return MONTHS.map((month) => {
    const source = byMonth.get(month);
    const incomeCents = source?.incomeCents ?? 0;
    const expensesCents = source?.expensesCents ?? 0;

    return {
      month,
      incomeCents,
      expensesCents,
      netCents: incomeCents - expensesCents,
      income: incomeCents / 100,
      expenses: expensesCents / 100,
      categories: monthlyByCategory?.[month] || {},
    };
  });
}

// Follows the system theme (Tailwind v4 `dark:` uses prefers-color-scheme).
// There is no shared theme context, so components that need colors in JS
// (Recharts SVG props) read the media query directly.
function useIsDarkMode() {
  const [isDark, setIsDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setIsDark(e.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  return isDark;
}

function Pill({ children, className = "" }) {
  return (
    <span className={"inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold " + className}>
      {children}
    </span>
  );
}

// Custom X-axis tick: the dataKey is the month number, so Recharts never
// confuses months that share an initial (J for January, June and July), but
// only the single letter is drawn to save space; the tooltip shows the full
// name.
function MonthAxisTick({ x, y, payload, fill }) {
  const letter = payload?.value ? monthName(payload.value, "narrow") : "";
  return (
    <text x={x} y={y + 16} textAnchor="middle" fontSize={12} fill={fill}>
      {letter}
    </text>
  );
}

// Custom chart tooltip, styled with the same Tailwind `dark:` classes as the
// rest of the page (Recharts' inline contentStyle/itemStyle merging proved
// unreliable for dark mode in this version).
function ChartTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;

  // The axis shows one letter: the tooltip shows the full month name.
  const month = payload[0]?.payload?.month;
  const displayLabel = month ? monthName(month) : null;

  return (
    <div className="bg-white dark:bg-gray-600 border border-slate-200 dark:border-gray-400 rounded-lg shadow-lg dark:shadow-[0_8px_24px_rgba(255,255,255,0.15)] px-3 py-2 text-sm">
      {displayLabel && <p className="font-semibold text-slate-800 dark:text-white mb-1">{displayLabel}</p>}
      {payload.map((entry) => (
        <p key={entry.dataKey} className="font-medium text-slate-700 dark:text-gray-200">
          <span
            className="inline-block w-2 h-2 rounded-full mr-1.5"
            style={{ backgroundColor: entry.color }}
          />
          {entry.name}: {formatAxisValue(entry.value)}
        </p>
      ))}
    </div>
  );
}

function SimpleCard({ children, className = "" }) {
  return (
    <div
      className={
        "bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl shadow-sm " +
        className
      }
    >
      {children}
    </div>
  );
}

const byName = (a, b) => a.localeCompare(b);

export default function Analytics() {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();
  const isDark = useIsDarkMode();

  const [availableYears, setAvailableYears] = useState([currentYear]);
  const [selectedYear, setSelectedYear] = useState(currentYear);

  // accountId "" = all accounts (aggregated, the default here, unlike the
  // Dashboard which always shows a single account).
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");

  const [monthlyRows, setMonthlyRows] = useState([]);
  // { [categoryName]: { totalCents, type } } for the selected year. Several
  // income categories are allowed, so the type comes from the data.
  const [categoryTotals, setCategoryTotals] = useState({});

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  // Month shown in the mobile breakdown; null = the default one (see
  // breakdownMonth below).
  const [pickedMonth, setPickedMonth] = useState(null);

  // Recharts grid/axis/cursor colors are SVG props, not Tailwind classes, so
  // they are picked by hand from the theme.
  const chartColors = isDark
    ? { grid: "#334155", tick: "#94a3b8", cursor: "#1e293b" }
    : { grid: "#e2e8f0", tick: "#64748b", cursor: "#f1f5f9" };

  useEffect(() => {
    apiFetch("/api/accounts")
      .then((res) => res.json())
      .then((data) => setAccounts(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Available years depend on the account: accounts can have different
  // histories.
  useEffect(() => {
    const accountParam = accountId ? `?accountId=${accountId}` : "";
    apiFetch(`/api/transactions/years${accountParam}`)
      .then((res) => res.json())
      .then((years) => {
        const list = Array.isArray(years) ? years : [];
        if (list.length) {
          setAvailableYears(list);
          setSelectedYear((prev) => (list.includes(prev) ? prev : list[0]));
        } else {
          setAvailableYears([currentYear]);
          setSelectedYear(currentYear);
        }
      })
      .catch(() => {});
  }, [accountId, currentYear]);

  // The whole year in one round trip (/api/analytics).
  const fetchAnalytics = useCallback(async (year, account) => {
    setIsLoading(true);
    setError(null);

    try {
      const accountParam = account ? `&accountId=${account}` : "";
      const res = await apiFetch(`/api/analytics?year=${year}${accountParam}`);
      const { monthly, categoryTotals: totals, monthlyByCategory } = await res.json();

      setCategoryTotals(
        Object.fromEntries(
          (Array.isArray(totals) ? totals : []).map((row) => [
            row.categoryName,
            { totalCents: row.totalCents, type: row.type },
          ]),
        ),
      );
      setMonthlyRows(buildMonthlyRows(monthly, monthlyByCategory));
    } catch {
      // Stores the translation key: the message follows language changes.
      setError("analytics.loadFailed");
      setMonthlyRows([]);
      setCategoryTotals({});
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAnalytics(selectedYear, accountId);
  }, [fetchAnalytics, selectedYear, accountId]);

  const yearTotals = useMemo(
    () =>
      monthlyRows.reduce(
        (acc, row) => ({
          incomeCents: acc.incomeCents + row.incomeCents,
          expensesCents: acc.expensesCents + row.expensesCents,
          netCents: acc.netCents + row.netCents,
        }),
        { incomeCents: 0, expensesCents: 0, netCents: 0 },
      ),
    [monthlyRows],
  );

  const yAxisMax = useMemo(
    () => niceAxisMax(monthlyRows.reduce((max, row) => Math.max(max, row.income, row.expenses), 0)),
    [monthlyRows],
  );

  // Categories present in the year, alphabetical, split by type.
  const incomeCategories = useMemo(
    () => Object.keys(categoryTotals).filter((name) => categoryTotals[name].type === "income").sort(byName),
    [categoryTotals],
  );
  const expenseCategories = useMemo(
    () => Object.keys(categoryTotals).filter((name) => categoryTotals[name].type !== "income").sort(byName),
    [categoryTotals],
  );

  // Mobile breakdown: only categories with a total, income first.
  function getMonthRowsForMobile(row) {
    return Object.entries(row.categories || {})
      .map(([name, cents]) => ({
        name,
        cents,
        kind: categoryTotals[name]?.type === "income" ? "income" : "expense",
      }))
      .filter((r) => r.cents > 0)
      .sort((a, b) => (a.kind !== b.kind ? (a.kind === "income" ? -1 : 1) : byName(a.name, b.name)));
  }

  // Mobile breakdown: the picked month, otherwise the current month (this
  // year) or the last month with data (past years).
  const lastMonthWithData =
    [...monthlyRows].reverse().find((row) => Object.keys(row.categories || {}).length > 0)?.month ?? 1;
  const breakdownMonth =
    pickedMonth ?? (selectedYear === currentYear ? new Date().getMonth() + 1 : lastMonthWithData);
  const breakdownRow = monthlyRows.find((row) => row.month === breakdownMonth);
  const breakdownRows = breakdownRow ? getMonthRowsForMobile(breakdownRow) : [];

  // Keeps the selected month chip centered in its scrollable row.
  const monthChipsRef = useRef(null);
  useEffect(() => {
    const row = monthChipsRef.current;
    const chip = row?.querySelector('[aria-selected="true"]');
    if (!row || !chip) return;
    row.scrollTo({ left: chip.offsetLeft - (row.clientWidth - chip.clientWidth) / 2 });
  }, [breakdownMonth, monthlyRows]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6 bg-slate-50 dark:bg-gray-900 min-h-screen">
      {/* Below ~430px the controls do not fit on one line: they wrap
          instead of overlapping. */}
      <div className="flex flex-wrap items-center gap-3">
        {accounts.length > 1 && (
          <AccountSelector accounts={accounts} accountId={accountId} onChange={setAccountId} />
        )}

        <PeriodSelector
          mode="year"
          year={selectedYear}
          availableYears={availableYears}
          onChange={({ year }) => {
            setSelectedYear(year);
            setPickedMonth(null);
          }}
          accountId={accountId}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-rose-50 dark:bg-rose-900/20 border-l-4 border-rose-500 p-4 rounded-md flex items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-rose-800 dark:text-rose-300 font-bold">
                {t("analytics.errorTitle")}
              </h3>
              <p className="text-rose-700 dark:text-rose-400 text-sm mt-1">
                {t(error)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchAnalytics(selectedYear, accountId)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200 hover:bg-rose-200 dark:hover:bg-rose-900/60 transition-colors shrink-0"
          >
            {t("analytics.retry")}
          </button>
        </div>
      )}

      {/* KPI: one card with three columns, like the dashboard. The year is
          already in the selector above. */}
      <SimpleCard className="grid grid-cols-3 divide-x divide-slate-100 dark:divide-gray-700">
        {[
          {
            label: t("dashboard.income"),
            icon: <TrendingUp className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />,
            cents: yearTotals.incomeCents,
            color: "text-emerald-600 dark:text-emerald-400",
          },
          {
            label: t("dashboard.expenses"),
            icon: <TrendingDown className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />,
            cents: yearTotals.expensesCents,
            color: "text-rose-600 dark:text-rose-400",
          },
          {
            label: t("analytics.netShort"),
            icon: <Scale className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />,
            cents: yearTotals.netCents,
            color: "text-blue-600 dark:text-blue-400",
          },
        ].map(({ label, icon, cents, color }) => (
          <div key={label} className="p-3 sm:p-4 min-w-0 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-1">
              <p className="type-caption font-semibold text-slate-500 dark:text-gray-400 leading-tight">
                {label}
              </p>
              {icon}
            </div>
            <p className={`mt-1.5 text-[17px] sm:text-2xl font-bold tabular-nums break-words ${color}`}>
              {formatWhole(cents)}
            </p>
          </div>
        ))}
      </SimpleCard>

      {/* Chart */}
      <SimpleCard>
        <div className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-4 mb-4 sm:mb-6">
            <h2 className="type-section text-slate-800 dark:text-white">
              {t("analytics.monthlyTrend")}
            </h2>
            {isLoading && (
              <div className="flex items-center gap-2 text-slate-500 dark:text-gray-400 type-secondary">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("common.loading")}
              </div>
            )}
          </div>

          <div className="h-64 sm:h-[360px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={monthlyRows}
                margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke={chartColors.grid}
                />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  tick={(props) => (
                    <MonthAxisTick {...props} fill={chartColors.tick} />
                  )}
                />
                <YAxis
                  domain={[0, yAxisMax]}
                  axisLine={false}
                  tickLine={false}
                  width={65}
                  tick={{ fill: chartColors.tick, fontSize: 11 }}
                  tickFormatter={formatAxisValue}
                />
                <Tooltip
                  cursor={{ fill: chartColors.cursor }}
                  content={<ChartTooltip />}
                />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ paddingTop: "20px", color: chartColors.tick }}
                  // Income first in every language (the default sorts by the
                  // translated label).
                  itemSorter={(item) => (item.dataKey === "income" ? 0 : 1)}
                />
                <Bar
                  dataKey="income"
                  name={t("dashboard.income")}
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
                <Bar
                  dataKey="expenses"
                  name={t("dashboard.expenses")}
                  fill="#f43f5e"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </SimpleCard>

      {/* Breakdown */}
      <SimpleCard>
        <div className="px-4 sm:px-6 pt-6 pb-3 border-b border-slate-100 dark:border-gray-700 flex items-center justify-between">
          <h2 className="type-section text-slate-800 dark:text-white">
            {t("analytics.breakdown")}
          </h2>
          <div className="hidden sm:flex items-center gap-2">
            <Pill className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400">
              {t("dashboard.income")}
            </Pill>
            <Pill className="bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400">
              {t("dashboard.expenses")}
            </Pill>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          {/* One month at a time, picked from a row of month pills (six per
              screen on phones, all twelve on wider screens) */}
          <div className="space-y-3">
            {/* Six months per screen width, the rest by swiping (snaps to a
                month). */}
            <div
              ref={monthChipsRef}
              className="relative grid grid-flow-col auto-cols-[calc((100%-2.5rem)/6)] sm:auto-cols-[calc((100%-5.5rem)/12)] gap-2 overflow-x-auto snap-x snap-mandatory pb-1"
              role="tablist"
            >
              {monthlyRows.map((row) => (
                <button
                  key={row.month}
                  type="button"
                  role="tab"
                  aria-selected={row.month === breakdownMonth}
                  onClick={() => setPickedMonth(row.month)}
                  className={`snap-start py-1.5 rounded-full type-label transition-colors ${
                    row.month === breakdownMonth
                      ? "bg-primary-600 text-white"
                      : "bg-slate-100 text-slate-600 dark:bg-gray-700 dark:text-gray-300"
                  }`}
                >
                  {monthName(row.month, "short")}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {breakdownRows.length === 0 ? (
                <div className="type-secondary text-slate-500 dark:text-gray-400 py-2">{t("analytics.noDataMonth")}</div>
              ) : (
                breakdownRows.map((r) => (
                  <div
                    key={r.name}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-gray-700/50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={
                          "w-2.5 h-2.5 rounded-full shrink-0 " +
                          (r.kind === "income" ? "bg-emerald-500" : "bg-rose-500")
                        }
                      />
                      <span className="type-row-title font-medium text-slate-700 dark:text-gray-200 break-words">
                        {r.name}
                      </span>
                    </div>
                    <span className="type-amount text-slate-800 dark:text-white">
                      {formatWhole(r.cents)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Yearly totals */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-emerald-50/60 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/40 rounded-xl p-4">
              <h3 className="type-section text-emerald-700 dark:text-emerald-400 mb-3">
                {t("analytics.incomeByCategory", { year: selectedYear })}
              </h3>

              <div className="space-y-2">
                {incomeCategories.map((name) => (
                  <div
                    key={name}
                    className="flex justify-between items-center bg-white/70 dark:bg-gray-900/30 p-3 rounded-lg"
                  >
                    <span className="type-row-title font-medium text-slate-700 dark:text-gray-200">
                      {name}
                    </span>
                    <span className="type-amount text-emerald-700 dark:text-emerald-400">
                      {formatWhole(categoryTotals[name]?.totalCents)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center p-3 mt-3 border-t border-emerald-200 dark:border-emerald-900/50">
                <span className="font-bold text-slate-800 dark:text-white">
                  {t("analytics.incomeTotal")}
                </span>
                <span className="font-black text-emerald-700 dark:text-emerald-400 text-lg">
                  {formatWhole(yearTotals.incomeCents)}
                </span>
              </div>
            </div>

            <div className="bg-rose-50/60 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/40 rounded-xl p-4">
              <h3 className="type-section text-rose-700 dark:text-rose-400 mb-3">
                {t("analytics.expensesByCategory", { year: selectedYear })}
              </h3>

              <div className="space-y-2">
                {expenseCategories.map((name) => (
                  <div
                    key={name}
                    className="flex justify-between items-center bg-white/70 dark:bg-gray-900/30 p-3 rounded-lg"
                  >
                    <span className="type-row-title font-medium text-slate-700 dark:text-gray-200">
                      {name}
                    </span>
                    <span className="type-amount text-rose-700 dark:text-rose-400">
                      {formatWhole(categoryTotals[name]?.totalCents)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center p-3 mt-3 border-t border-rose-200 dark:border-rose-900/50">
                <span className="font-bold text-slate-800 dark:text-white">
                  {t("analytics.expensesTotal")}
                </span>
                <span className="font-black text-rose-700 dark:text-rose-400 text-lg">
                  {formatWhole(yearTotals.expensesCents)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </SimpleCard>
    </div>
  );
}
