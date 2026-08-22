import { apiServerFetch } from "@/lib/apiServer";
import type { AdminUserDTO } from "@pollos/shared";
import { UsersManager } from "./UsersManager";

export default async function UsersPage() {
  const users = await apiServerFetch<AdminUserDTO[]>("/api/admin-users");

  return (
    <div>
      <h2>Usuarios</h2>
      <p className="muted" style={{ marginTop: -16, marginBottom: 24 }}>
        Solo el administrador puede crear usuarios y decidir que secciones puede usar cada uno. Configuración y Usuarios son
        exclusivos del administrador.
      </p>
      <UsersManager initialUsers={users} />
    </div>
  );
}
