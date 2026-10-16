import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, TrendingUp, TrendingDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiFetch, readJson } from "../../services/api";
import { errorMessage } from "../../utils/errors";

// Category management (add, rename, recolor, delete), shared by Settings and
// the post-registration wizard. Each category has a type ('income' or
// 'expense') chosen at creation and fixed afterwards; any number of income
// categories is allowed.
export default function CategoryManager() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3B82F6");
  const [newType, setNewType] = useState("expense");
  const [loading, setLoading] = useState(false);
  // The "new category" form stays folded behind a button: the list comes
  // first on a phone.
  const [addOpen, setAddOpen] = useState(false);

  const [editingNameId, setEditingNameId] = useState(null);
  const [editName, setEditName] = useState("");

  const fetchCategories = useCallback(async () => {
    try {
      const res = await apiFetch("/api/categories");
      setCategories(await res.json());
    } catch (err) {
      console.error("Failed to load categories:", err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCategories();
  }, [fetchCategories]);

  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setLoading(true);
    try {
      const res = await apiFetch("/api/categories", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), color: newColor, type: newType }),
      });

      if (res.ok) {
        setNewName("");
        setAddOpen(false);
        setNewType("expense");
        fetchCategories();
      } else {
        alert(errorMessage(await readJson(res), "categories.addFailed"));
      }
    } catch {
      alert(t("errors.network"));
    } finally {
      setLoading(false);
    }
  };

  const handleColorChange = async (id, color) => {
    // Optimistic update: the UI changes right away; on failure, refetch.
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, color } : c)));
    try {
      const res = await apiFetch(`/api/categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ color }),
      });
      if (!res.ok) {
        alert(errorMessage(await readJson(res), "categories.colorFailed"));
        fetchCategories();
      }
    } catch {
      alert(t("errors.network"));
      fetchCategories();
    }
  };

  const startEditName = (category) => {
    setEditingNameId(category.id);
    setEditName(category.name);
  };

  const saveName = async (id) => {
    setEditingNameId(null);
    const name = editName.trim();
    if (!name) return fetchCategories();
    try {
      const res = await apiFetch(`/api/categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        alert(errorMessage(await readJson(res), "categories.renameFailed"));
      }
      fetchCategories();
    } catch {
      alert(t("errors.network"));
      fetchCategories();
    }
  };

  const handleDeleteCategory = async (id, name) => {
    if (!window.confirm(t("categories.confirmDelete", { name }))) return;

    try {
      const res = await apiFetch(`/api/categories/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchCategories();
      } else {
        alert(errorMessage(await readJson(res), "categories.deleteFailed"));
      }
    } catch {
      alert(t("errors.network"));
    }
  };

  return (
    <>
      {addOpen ? (
        <form onSubmit={handleAddCategory} className="flex flex-wrap gap-3 mb-4 items-end p-3 rounded-xl border border-gray-200 dark:border-gray-600">
          <div className="basis-full">
            <label className="block type-label text-gray-500 dark:text-gray-400 mb-1">
              {t("categories.new")}
            </label>
            <input
              type="text"
              maxLength={50}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("categories.newPlaceholder")}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:border-primary-500"
              required
            />
          </div>

          <div>
            <label className="block type-label text-gray-500 dark:text-gray-400 mb-1">
              {t("categories.type")}
            </label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:border-primary-500"
            >
              <option value="expense">{t("categories.expense")}</option>
              <option value="income">{t("categories.income")}</option>
            </select>
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
          <Plus className="w-4 h-4" /> {t("categories.new")}
        </button>
      )}

      {/* No inner scroll box: the list scrolls with the page (nested
          scrolling is awkward on touch screens). */}
      <div className="space-y-2">
        {categories.map((category) => (
          <div
            key={category.id}
            className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <input
                type="color"
                value={category.color}
                onChange={(e) => handleColorChange(category.id, e.target.value)}
                className="w-7 h-7 rounded-full border border-gray-200 dark:border-gray-600 cursor-pointer p-0 shrink-0"
                title={t("common.changeColor")}
                aria-label={t("categories.colorOf", { name: category.name })}
              />
              {category.type === "income" ? (
                <TrendingUp
                  className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0"
                  aria-label={t("categories.incomeCategory")}
                />
              ) : (
                <TrendingDown
                  className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0"
                  aria-label={t("categories.expenseCategory")}
                />
              )}
              {editingNameId === category.id ? (
                <input
                  type="text"
                  maxLength={50}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => saveName(category.id)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  autoFocus
                  className="min-w-0 flex-1 px-2 py-1 rounded-lg border border-primary-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEditName(category)}
                  className="min-w-0 type-row-title text-gray-700 dark:text-gray-200 break-words text-left hover:underline"
                  title={t("common.rename")}
                >
                  {category.name}
                </button>
              )}
            </div>

            <button
              onClick={() => handleDeleteCategory(category.id, category.name)}
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
