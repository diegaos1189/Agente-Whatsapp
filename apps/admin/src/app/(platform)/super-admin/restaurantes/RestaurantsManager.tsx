"use client";

import { useEffect, useState } from "react";
import { RestaurantModal, type RestaurantDraft } from "./RestaurantModal";
import { RestaurantRow } from "./RestaurantRow";
import { ConfirmDialog } from "./ConfirmDialog";
import { SEED_RESTAURANTS, todayIso, type PlatformRestaurant } from "./types";

const STORAGE_KEY = "platform-restaurants-mock";

type ModalState = { mode: "create" } | { mode: "edit"; restaurant: PlatformRestaurant } | null;

export function RestaurantsManager() {
  const [restaurants, setRestaurants] = useState<PlatformRestaurant[]>(SEED_RESTAURANTS);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [deactivating, setDeactivating] = useState<PlatformRestaurant | null>(null);
  // Hasta que no se leyo localStorage no se escribe, si no el primer render pisaria lo guardado
  // con la semilla.
  const [loaded, setLoaded] = useState(false);

  // Persistencia solo para poder mostrar la pantalla sin que se reinicie en cada refresh.
  // Cuando exista backend multi-tenant esto se reemplaza por fetch.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setRestaurants(JSON.parse(stored) as PlatformRestaurant[]);
    } catch {
      // localStorage bloqueado o JSON corrupto: se queda con la semilla
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(restaurants));
    } catch {
      // sin persistencia, la lista sigue funcionando en memoria
    }
  }, [restaurants, loaded]);

  const term = query.trim().toLowerCase();
  const visible = term
    ? restaurants.filter((r) => r.name.toLowerCase().includes(term) || r.city.toLowerCase().includes(term))
    : restaurants;
  const activeCount = restaurants.filter((r) => r.status === "ACTIVE").length;

  function handleSave(draft: RestaurantDraft) {
    if (modal?.mode === "edit") {
      const id = modal.restaurant.id;
      setRestaurants((prev) => prev.map((r) => (r.id === id ? { ...r, ...draft } : r)));
    } else {
      setRestaurants((prev) => [
        ...prev,
        { ...draft, id: `r-${Date.now().toString(36)}`, createdAt: todayIso() },
      ]);
    }
    setModal(null);
  }

  function setStatus(id: string, status: PlatformRestaurant["status"]) {
    setRestaurants((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
  }

  function handleDelete(id: string) {
    setRestaurants((prev) => prev.filter((r) => r.id !== id));
    setModal(null);
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
        {/* Buscador local, no el <SearchBox> de query string: la lista vive en estado del cliente. */}
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
                  {term ? `Ningún restaurante coincide con "${query.trim()}".` : "Aún no hay restaurantes. Crea el primero arriba."}
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
