"use client";

import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { CURRENCY_OPTIONS, type PlatformRestaurant, type RestaurantStatus } from "./types";

// Sin slug: lo genera la API a partir del nombre y no se edita desde el panel.
export type RestaurantDraft = Omit<PlatformRestaurant, "id" | "slug" | "createdAt">;

/**
 * Alta rapida / edicion de un restaurante. A proposito solo pide lo minimo para crearlo: el
 * resto de la configuracion (menu, horario, mensajes, WhatsApp) se hace despues dentro del
 * panel de ese restaurante, no aca.
 */
export function RestaurantModal({
  mode,
  restaurant,
  onClose,
  onSave,
  onDelete,
}: {
  mode: "create" | "edit";
  restaurant?: PlatformRestaurant;
  onClose: () => void;
  onSave: (draft: RestaurantDraft) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(restaurant?.name ?? "");
  const [city, setCity] = useState(restaurant?.city ?? "");
  const [address, setAddress] = useState(restaurant?.address ?? "");
  const [ownerPhone, setOwnerPhone] = useState(restaurant?.ownerPhone ?? "");
  const [ownerEmail, setOwnerEmail] = useState(restaurant?.ownerEmail ?? "");
  const [currency, setCurrency] = useState(restaurant?.currency ?? CURRENCY_OPTIONS[0].code);
  const [status, setStatus] = useState<RestaurantStatus>(restaurant?.status ?? "ACTIVE");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasContact = ownerPhone.trim() !== "" || ownerEmail.trim() !== "";
  const canSubmit = name.trim() !== "" && city.trim() !== "" && hasContact;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasContact) {
      setError("Deja al menos un contacto del dueño: teléfono o email.");
      return;
    }
    setError(null);
    onSave({
      name: name.trim(),
      city: city.trim(),
      address: address.trim(),
      ownerPhone: ownerPhone.trim(),
      ownerEmail: ownerEmail.trim(),
      currency,
      status,
    });
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: "94vw",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--surface-solid)",
          padding: 24,
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <h4 style={{ marginTop: 0 }}>{mode === "create" ? "Nuevo restaurante" : `Editar: ${restaurant?.name}`}</h4>
        <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
          Solo los datos para crearlo. El menú, el horario y WhatsApp se configuran adentro.
        </p>

        <form className="card-form" onSubmit={handleSubmit} style={{ padding: 0, border: "none", boxShadow: "none", gap: 12 }}>
          <label>
            Nombre del restaurante
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Pizzería Don Marco" required autoFocus />
          </label>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ flex: "1 1 160px" }}>
              Teléfono del dueño
              <input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="+57 300 000 0000" />
            </label>
            <label style={{ flex: "1 1 160px" }}>
              Email del dueño
              <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="dueno@correo.com" />
            </label>
          </div>
          {!hasContact && <div className="muted">Deja al menos uno de los dos para poder contactarlo.</div>}

          <label>
            Ciudad
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ej: Medellín" required />
          </label>

          <label>
            Dirección (opcional)
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle 10 #38-24" />
          </label>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ flex: "1 1 160px" }}>
              Moneda
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ flex: "1 1 160px" }}>
              Estado
              <select value={status} onChange={(e) => setStatus(e.target.value as RestaurantStatus)}>
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
              </select>
            </label>
          </div>

          {error && <div className="error-text">{error}</div>}

          <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
            <div>
              {mode === "edit" && onDelete && (
                // Secundario a proposito: lo normal es desactivar (se revierte), borrar es la salida rara.
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setConfirmingDelete(true)}
                  style={{ color: "var(--danger)" }}
                >
                  Eliminar
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="secondary" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="cta" disabled={!canSubmit}>
                {mode === "create" ? "Crear restaurante" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </form>
      </div>

      {confirmingDelete && restaurant && onDelete && (
        <ConfirmDialog
          title="Eliminar restaurante"
          message={
            <>
              Se borrará <strong>{restaurant.name}</strong> de la lista. Esta acción no se puede deshacer — si solo quieres
              pausarlo, ciérralo y usa <strong>Desactivar</strong>. Escribe <strong>confirmar</strong> para continuar.
            </>
          }
          confirmLabel="Eliminar"
          danger
          requireTyping
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={onDelete}
        />
      )}
    </div>
  );
}
