"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { CategoryDTO } from "@pollos/shared";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function AddCategoryForm({ categories }: { categories: CategoryDTO[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [parentCategoryId, setParentCategoryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiClientFetch("/categories", {
        method: "POST",
        body: JSON.stringify({ name, slug: slugify(name), parentCategoryId: parentCategoryId || null }),
      });
      setName("");
      setParentCategoryId("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creando categoria");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card-form" onSubmit={handleSubmit} style={{ justifyContent: "space-between", minWidth: 260 }}>
      <div>
        <h4>Nueva categoria</h4>
        <label>
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Postres" required />
        </label>
        <label>
          Categoria padre (opcional)
          <select value={parentCategoryId} onChange={(e) => setParentCategoryId(e.target.value)}>
            <option value="">Ninguna — es una categoria principal</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          Si eliges una categoria padre, esta se muestra como subcategoria dentro de ella en el menu de WhatsApp.
        </p>
        {error && <div className="error-text">{error}</div>}
      </div>
      <button type="submit" className="cta" disabled={saving || !name.trim()}>
        {saving ? "Creando..." : "Crear categoria"}
      </button>
    </form>
  );
}
