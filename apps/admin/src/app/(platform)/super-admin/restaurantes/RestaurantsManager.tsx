"use client";

import { useEffect, useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import { RestaurantModal, type RestaurantDraft } from "./RestaurantModal";
import { RestaurantRow } from "./RestaurantRow";
import { ConfirmDialog } from "./ConfirmDialog";
import { LEGACY_SEED_IDS, type PlatformRestaurant } from "./types";

/** Clave donde la version anterior (sin backend) guardaba la lista en el navegador. */
const LEGACY_STORAGE_KEY = "platform-restaurants-mock";

type ModalState = { mode: "create" } | { mode: "edit"; restaurant: PlatformRestaurant } | null;

/**
 * Si este navegador tiene restaurantes de la epoca sin backend (localStorage) y la base de
 * datos aun esta vacia, los sube una sola vez para no perder lo que el dueño ya registro.
 */
async function importLegacyLocalRestaurants(serverList: PlatformRestaurant[]): Promise<PlatformRestaurant[]> {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return serverList;
  }
  if (!stored) return serverList;

  if (serverList.length === 0) {
    let legacy: PlatformRestaurant[] = [];
    try {
      legacy = (JSON.parse(stored) as PlatformRestaurant[]).filter((r) => !LEGACY_SEED_IDS.includes(r.id));
    } catch {
      legacy = [];
    }
    for (const r of legacy) {
      await apiClientFetch<PlatformRestaurant>("/platform/restaurants", {
        method: "POST",
        body: JSON.stringify({
          name: r.name,
          city: r.city,
          address: r.address,
          ownerPhone: r.ownerPhone,
          ownerEmail: r.ownerEmail,
          currency: r.currency,
          status: r.status,
        }),
      });
    }
    if (legacy.length > 0) {
      serverList = await apiClientFetch<PlatformRestaurant[]>("/platform/restaurants");
    }
  }

  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // sin permisos de localStorage: no pasa nada, el import ya quedo hecho
  }
  return serverList;
}

export function RestaurantsManager() {
  const [restaurants, setRestaurants] = useState<PlatformRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [deactivating, setDeactivating] = useState<PlatformRestaurant | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let list = await apiClientFetch<PlatformRestaurant[]>("/platform/restaurants");
        list = await importLegacyLocalRestaurants(list);
        if (!cancelled) setRestaurants(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudo cargar la lista.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const term = query.trim().toLowerCase();
  const visible = term
    ? restaurants.filter((r) => r.name.toLowerCase().includes(term) || r.city.toLowerCase().includes(term))
    : restaurants;
  const activeCount = restaurants.filter((r) => r.status === "ACTIVE").length;

  async function handleSave(draft: RestaurantDraft) {
    setError(null);
    try {
      if (modal?.mode === "edit") {
        const id = modal.restaurant.id;
        const updated = await apiClientFetch<PlatformRestaurant>(`/platform/restaurants/${id}`, {
          method: "PATCH",
          body: JSON.stringify(draft),
        });
        setRestaurants((prev) => prev.map((r) => (r.id === id ? updated : r)));
      } else {
        const created = await apiClientFetch<PlatformRestaurant>("/platform/restaurants", {
          method: "POST",
          body: JSON.stringify(draft),
        });
        setRestaurants((prev) => [...prev, created]);
      }
      setModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el restaurante.");
    }
  }

  async function setStatus(id: string, status: PlatformRestaurant["status"]) {
    setError(null);
    try {
      const updated = await apiClientFetch<PlatformRestaurant>(`/platform/restaurants/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setRestaurants((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el estado.");
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiClientFetch<{ ok: boolean }>(`/platform/restaurants/${id}`, { method: "DELETE" });
      setRestaurants((prev) => prev.filter((r) => r.id !== id));
      setModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el restaurante.");
    }
  }

  return (
    <div>
      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Restaurantes</div>
          <div className="stat-value">{restaurants.length}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Activos</div>
          <div className="stat-value ok">{activeCount}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Inactivos</div>
          <div className="stat-value">{restaurants.length - activeCount}</div>
        </div>
      </div>

      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 12 }}
      >
        {/* Buscador local, no el <SearchBox> de query string: la lista ya esta cargada en el cliente. */}
        <div className="search-box">
          <span className="search-box-icon">⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o ciudad"
            aria-label="Buscar restaurante"
          />
        </div>
        <button type="button" className="cta" onClick={() => setModal({ mode: "create" })}>
          + Nuevo restaurante
        </button>
      </div>

      {error && (
        <div className="error-text" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Ciudad</th>
              <th>Contacto del dueño</th>
              <th>Moneda</th>
              <th>Estado</th>
              <th>Creado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <RestaurantRow
                key={r.id}
                restaurant={r}
                onEdit={() => setModal({ mode: "edit", restaurant: r })}
                onToggleStatus={() => (r.status === "ACTIVE" ? setDeactivating(r) : setStatus(r.id, "ACTIVE"))}
              />
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {loading
                    ? "Cargando restaurantes…"
                    : term
                      ? `Ningún restaurante coincide con "${query.trim()}".`
                      : "Aún no hay restaurantes. Crea el primero arriba."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <RestaurantModal
          mode={modal.mode}
          restaurant={modal.mode === "edit" ? modal.restaurant : undefined}
          onClose={() => setModal(null)}
          onSave={handleSave}
          onDelete={modal.mode === "edit" ? () => handleDelete(modal.restaurant.id) : undefined}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          title="Desactivar restaurante"
          message={
            <>
              <strong>{deactivating.name}</strong> queda inactivo: su agente deja de responder y no aparece como activo. Se puede
              volver a activar cuando quieras.
            </>
          }
          confirmLabel="Desactivar"
          danger
          onCancel={() => setDeactivating(null)}
          onConfirm={() => {
            setStatus(deactivating.id, "INACTIVE");
            setDeactivating(null);
          }}
        />
      )}
    </div>
  );
}
