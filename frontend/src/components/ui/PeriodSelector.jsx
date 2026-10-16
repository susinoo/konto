import { useEffect, useState } from "react";
import { Calendar, ChevronDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../../services/api";
import { monthName } from "../../utils/format";

const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// Year (and month) picker in a bottom sheet. Years and months are numbers
// (month 1-12); onChange receives { year } or { year, month }.
export default function PeriodSelector({
  year,
  month,
  onChange,
  availableYears = [],
  accountId = null,
  className = "",
  mode = "month-year", // "month-year" | "year"
}) {
  const { t } = useTranslation();
  const isYearOnly = mode === "year";
  const now = new Date();
  const currentYear = year || now.getFullYear();
  const currentMonth = month || now.getMonth() + 1;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(currentYear);
  const [draftMonth, setDraftMonth] = useState(currentMonth);
  const [availableMonths, setAvailableMonths] = useState([]);

  // Abbreviated month on phones ("Oct 2026"), so the period and account
  // selectors fit side by side in every language.
  const periodLabel = isYearOnly
    ? String(currentYear)
    : `${monthName(currentMonth)} ${currentYear}`;
  const shortPeriodLabel = isYearOnly
    ? periodLabel
    : `${monthName(currentMonth, "short")} ${currentYear}`;

  const openSheet = () => {
    setDraftYear(currentYear);
    setDraftMonth(currentMonth);
    setSheetOpen(true);
  };

  // While the sheet is open, load the months that have transactions for the
  // chosen year (and account).
  useEffect(() => {
    if (isYearOnly || !sheetOpen || !draftYear) return;

    let cancelled = false;
    const accountParam = accountId ? `&accountId=${encodeURIComponent(accountId)}` : "";

    apiFetch(`/api/transactions/months?year=${draftYear}${accountParam}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const months = Array.isArray(data) ? data : [];
        setAvailableMonths(months);
        setDraftMonth((prev) => (months.length > 0 && !months.includes(prev) ? months[0] : prev));
      })
      .catch(() => {
        if (!cancelled) setAvailableMonths([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isYearOnly, sheetOpen, draftYear, accountId]);

  const applyPeriod = () => {
    if (onChange) {
      onChange(isYearOnly ? { year: draftYear } : { year: draftYear, month: draftMonth });
    }
    setSheetOpen(false);
  };

  const yearsToDisplay = availableYears.length > 0 ? availableYears : [currentYear];
  const monthsToDisplay = availableMonths.length > 0 ? availableMonths : ALL_MONTHS;

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors type-label ${className}`}
      >
        <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400 shrink-0" />
        <span className="capitalize truncate sm:hidden">{shortPeriodLabel}</span>
        <span className="capitalize hidden sm:inline">{periodLabel}</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      </button>

      {sheetOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setSheetOpen(false)}
            aria-label={t("common.close")}
          />

          {/* Centered dialog. The wrapper lets taps through to the backdrop
              (pointer-events-none); only the panel catches them. */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            role="dialog"
            aria-modal="true"
          >
            <div className="pointer-events-auto w-full max-w-sm max-h-[85dvh] overflow-y-auto bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="type-section text-gray-900 dark:text-white">
                  {isYearOnly ? t("period.selectYear") : t("period.selectPeriod")}
                </h3>
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  aria-label={t("common.close")}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className={isYearOnly ? "space-y-3" : "grid grid-cols-2 gap-3"}>
                <div>
                  <label className="block type-label text-gray-500 dark:text-gray-400 mb-1">
                    {t("period.year")}
                  </label>
                  <select
                    value={draftYear}
                    onChange={(e) => setDraftYear(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 outline-none"
                  >
                    {yearsToDisplay.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>

                {!isYearOnly && (
                  <div>
                    <label className="block type-label text-gray-500 dark:text-gray-400 mb-1">
                      {t("period.month")}
                    </label>
                    <select
                      value={draftMonth}
                      onChange={(e) => setDraftMonth(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 outline-none capitalize"
                    >
                      {monthsToDisplay.map((m) => (
                        <option key={m} value={m}>
                          {monthName(m)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={applyPeriod}
                className="mt-4 w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 rounded-2xl transition-colors"
              >
                {t("period.apply")}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
