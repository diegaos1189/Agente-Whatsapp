"use client";

import { formatDate, type PlatformRestaurant } from "./types";

export function RestaurantRow({
  restaurant,
  onEdit,
  onToggleStatus,
}: {
  restaurant: PlatformRestaurant;
  onEdit: () => void;
  onToggleStatus: () => void;
}) {
  const isActive = restaurant.status === "ACTIVE";
  // Las filas solo se renderizan en el cliente (la lista llega por fetch post-mount), asi que
  // window esta disponible; el guard es solo por si esto se reusa en un contexto con SSR.
  const linkHost = typeof window !== "undefined" ? window.location.host : "";

  return (
    <tr>
      <td>
        <strong>{restaurant.name}</strong>
        {restaurant.address && (
          <div className="muted" style={{ fontSize: 11 }}>
            {restaurant.address}
          </div>
        )}
      </td>
      <td>
        <a href={`/${restaurant.slug}`} target="_blank" rel="noreferrer" style={{ whiteSpace: "nowrap" }}>
          {linkHost}/{restaurant.slug}
        </a>
      </td>
      <td>{restaurant.city}</td>
      <td>
        {restaurant.ownerPhone || <span className="muted">-</span>}
        {restaurant.ownerEmail && (
          <div className="muted" style={{ fontSize: 11 }}>
            {restaurant.ownerEmail}
          </div>
        )}
      </td>
      <td>{restaurant.currency}</td>
      <td>
        <span className={`pill ${isActive ? "pill-success" : "pill-neutral"}`}>{isActive ? "Activo" : "Inactivo"}</span>
      </td>
      <td>{formatDate(restaurant.createdAt)}</td>
      <td>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="secondary" onClick={onEdit}>
            Editar
          </button>
          <button type="button" className={isActive ? "danger" : "cta"} onClick={onToggleStatus}>
            {isActive ? "Desactivar" : "Activar"}
          </button>
        </div>
      </td>
    </tr>
  );
}
