"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { AdminUserDTO } from "@pollos/shared";
import { PERMISSION_KEYS, ADMIN_ROLE, STAFF_ROLE, type PermissionKey } from "@/lib/authConstants";

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  metrics: "Métricas",
  conversations: "Conversaciones",
  orders: "Pedidos",
  products: "Productos",
  promotions: "Promociones",
  faqs: "Preguntas frecuentes",
  kitchen: "Cocina",
  facturacion: "Facturación",
};

function PermissionCheckboxes({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      {PERMISSION_KEYS.map((key) => (
        <label key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 400 }}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.includes(key)}
            onChange={(e) => onChange(e.target.checked ? [...value, key] : value.filter((v) => v !== key))}
          />
          {PERMISSION_LABELS[key]}
        </label>
      ))}
    </div>
  );
}

function NewUserForm({ onCreated }: { onCreated: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "STAFF">(STAFF_ROLE);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiClientFetch("/admin-users", {
        method: "POST",
        body: JSON.stringify({ username, password, role, permissions }),
      });
      setUsername("");
      setPassword("");
      setRole(STAFF_ROLE);
      setPermissions([]);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creando usuario");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card-form" onSubmit={handleSubmit} style={{ maxWidth: 480, marginBottom: 24 }}>
      <h4>Nuevo usuario</h4>
      <label>
        Usuario
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Ej: juan" required />
      </label>
      <label>
        Contraseña
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
        <input type="checkbox" checked={role === ADMIN_ROLE} onChange={(e) => setRole(e.target.checked ? ADMIN_ROLE : STAFF_ROLE)} />
        Es administrador (acceso total, incluye Configuración y Usuarios)
      </label>
      {role === STAFF_ROLE && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Secciones habilitadas</div>
          <PermissionCheckboxes value={permissions} onChange={setPermissions} disabled={false} />
        </div>
      )}
      {error && <div className="error-text">{error}</div>}
      <button type="submit" disabled={saving || !username.trim() || !password}>
        {saving ? "Creando..." : "Crear usuario"}
      </button>
    </form>
  );
}

function UserRow({ user, onChanged }: { user: AdminUserDTO; onChanged: () => void }) {
  const [permissions, setPermissions] = useState<string[]>(user.permissions);
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const isAdmin = user.role === ADMIN_ROLE;
  const dirty = JSON.stringify(permissions) !== JSON.stringify(user.permissions);

  async function savePermissions() {
    setSaving(true);
    try {
      await apiClientFetch(`/admin-users/${user.id}`, { method: "PATCH", body: JSON.stringify({ permissions }) });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword() {
    if (!newPassword) return;
    setSaving(true);
    try {
      await apiClientFetch(`/admin-users/${user.id}`, { method: "PATCH", body: JSON.stringify({ password: newPassword }) });
      setNewPassword("");
    } finally {
      setSaving(false);
    }
  }

  async function toggleRole() {
    setSaving(true);
    try {
      await apiClientFetch(`/admin-users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: isAdmin ? STAFF_ROLE : ADMIN_ROLE }),
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`¿Eliminar al usuario "${user.username}"?`)) return;
    setSaving(true);
    try {
      await apiClientFetch(`/admin-users/${user.id}`, { method: "DELETE" });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td>{user.username}</td>
      <td>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
          <input type="checkbox" checked={isAdmin} onChange={toggleRole} disabled={saving} />
          {isAdmin ? "Administrador" : "Usuario"}
        </label>
      </td>
      <td>
        {isAdmin ? (
          <span className="muted">Todas (administrador)</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <PermissionCheckboxes value={permissions} onChange={setPermissions} disabled={saving} />
            {dirty && (
              <button type="button" onClick={savePermissions} disabled={saving} style={{ alignSelf: "flex-start" }}>
                Guardar permisos
              </button>
            )}
          </div>
        )}
      </td>
      <td>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="password"
            placeholder="Nueva contraseña"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{ width: 130 }}
          />
          <button type="button" className="secondary" disabled={saving || !newPassword} onClick={resetPassword}>
            Cambiar
          </button>
        </div>
      </td>
      <td>
        <button type="button" className="danger" disabled={saving} onClick={remove}>
          Eliminar
        </button>
      </td>
    </tr>
  );
}

export function UsersManager({ initialUsers }: { initialUsers: AdminUserDTO[] }) {
  const router = useRouter();

  return (
    <div>
      <NewUserForm onCreated={() => router.refresh()} />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Rol</th>
              <th>Secciones habilitadas</th>
              <th>Contraseña</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {initialUsers.map((u) => (
              <UserRow key={u.id} user={u} onChanged={() => router.refresh()} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
