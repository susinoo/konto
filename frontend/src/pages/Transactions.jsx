import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PlusCircle, List } from "lucide-react";
import { useTranslation } from "react-i18next";

import TransactionList from "../components/transactions/TransactionList";
import TransactionForm from "../components/transactions/TransactionForm";

// Query-string helpers: valid values become numbers, anything else null.
function parseMonthParam(value) {
  if (!/^\d{1,2}$/.test(String(value ?? "").trim())) return null;
  const month = Number(value);
  return month >= 1 && month <= 12 ? month : null;
}

function parseYearParam(value) {
  return /^\d{4}$/.test(String(value ?? "").trim()) ? Number(value) : null;
}

export default function Transactions() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const query = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const queryAction = query.get("action");
  const queryYear = parseYearParam(query.get("year"));
  const queryMonth = parseMonthParam(query.get("month"));

  // Initial tab: the form when opened with action=add, the list otherwise.
  const [activeTab, setActiveTab] = useState(() => {
    return queryAction === "add" ? "add" : "list";
  });

  // action=add can also arrive later, through client-side navigation without
  // a remount (e.g. the FAB while already on /transactions): the form is
  // opened by adjusting state during render, React's recommended pattern
  // instead of a synchronous setState in an effect.
  const [prevQueryAction, setPrevQueryAction] = useState(queryAction);
  if (queryAction !== prevQueryAction) {
    setPrevQueryAction(queryAction);
    if (queryAction === "add") setActiveTab("add");
  }

  // On mobile there are no tabs: tapping "Transactions" in the bottom bar
  // (a new navigation to the same URL, hence a new location key) goes back
  // to the list.
  const [prevLocationKey, setPrevLocationKey] = useState(location.key);
  if (location.key !== prevLocationKey) {
    setPrevLocationKey(location.key);
    if (queryAction !== "add" && !location.state?.keepTab) setActiveTab("list");
  }

  // Consume "action=add" by removing it from the query string: otherwise a
  // second tap on the FAB (same link, same URL) would not change the
  // location and the form would not reopen. Other parameters (year/month)
  // are kept.
  useEffect(() => {
    if (queryAction === "add") {
      const params = new URLSearchParams(location.search);
      params.delete("action");
      const qs = params.toString();
      navigate(
        location.pathname + (qs ? `?${qs}` : "") + (location.hash || ""),
        { replace: true, state: { keepTab: true } },
      );
    }
  }, [queryAction, navigate, location.pathname, location.search, location.hash]);

  return (
    <div className="p-4 sm:p-6 animate-in fade-in duration-300">
      {/* List / new transaction toggle (desktop; on mobile the floating +
          button opens the form and the form has its own close button) */}
      <div className="hidden mb-6 sm:flex bg-gray-100 dark:bg-gray-900 rounded-xl p-1 shadow-inner max-w-sm mx-auto sm:max-w-none sm:mx-0">
        <button
          onClick={() => setActiveTab("list")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
            activeTab === "list"
              ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm ring-1 ring-gray-200 dark:ring-gray-700"
              : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          <List className="w-5 h-5" /> {t("transactions.listTab")}
        </button>

        <button
          onClick={() => setActiveTab("add")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
            activeTab === "add"
              ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm ring-1 ring-gray-200 dark:ring-gray-700"
              : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          <PlusCircle className="w-5 h-5" /> {t("transactions.newTab")}
        </button>
      </div>

      <div className="sm:mt-4">
        {activeTab === "list" ? (
          <TransactionList initialYear={queryYear} initialMonth={queryMonth} />
        ) : (
          <TransactionForm
            onTransactionAdded={() => setActiveTab("list")}
            onClose={() => setActiveTab("list")}
          />
        )}
      </div>
    </div>
  );
}
