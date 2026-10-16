import { useMemo, useState } from "react";
import { ChevronDown, Home } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatMoney } from "../../utils/format";

// Account dropdown. accountId "" means "all accounts" (only offered when
// showAllOption is true).
export default function AccountSelector({
  accounts = [],
  accountId = "",
  onChange,
  showAllOption = true,
  className = "",
  containerClassName = "",
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const activeAccount = useMemo(() => {
    if (!accountId) return null;
    return accounts.find((a) => String(a.id) === String(accountId)) || null;
  }, [accounts, accountId]);

  const isAll = !accountId || !activeAccount;

  const totalBalanceCents = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.balanceCents || 0), 0),
    [accounts],
  );

  return (
    <div className={`relative inline-block ${containerClassName}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors type-label ${className}`}
      >
        {isAll ? (
          <Home className="w-4 h-4 text-gray-500 dark:text-gray-400 shrink-0" />
        ) : (
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: activeAccount?.color || "#6B7280" }}
            aria-hidden="true"
          />
        )}
        <span className="truncate min-w-0 sm:max-w-[200px]">
          {isAll ? t("accounts.all") : activeAccount?.name || t("accounts.select")}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-label={t("common.close")}
          />
          <div className="absolute left-0 top-full mt-2 z-50 w-64 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-lg overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
            <div className="py-1">
              {showAllOption && (
                <button
                  type="button"
                  onClick={() => {
                    if (onChange) onChange("");
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                    isAll ? "bg-primary-50 dark:bg-primary-900/20" : ""
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Home className="w-4 h-4 text-gray-500 dark:text-gray-400 shrink-0" />
                    <span className="type-row-title text-gray-900 dark:text-white truncate">
                      {t("accounts.all")}
                    </span>
                  </span>
                  <span className="type-secondary font-medium text-gray-500 dark:text-gray-400 shrink-0">
                    {formatMoney(totalBalanceCents)}
                  </span>
                </button>
              )}

              {accounts.map((account) => {
                const isSelected = String(accountId) === String(account.id);
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => {
                      if (onChange) onChange(String(account.id));
                      setOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                      isSelected ? "bg-primary-50 dark:bg-primary-900/20" : ""
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
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
