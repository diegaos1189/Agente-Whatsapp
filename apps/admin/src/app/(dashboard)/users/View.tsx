import { apiServerFetchScoped } from "@/lib/apiServer";
import type { AdminUserDTO } from "@pollos/shared";
import { UsersManager } from "./UsersManager";

export async function UsersView({
  restaurantId,
  basePath = "",
  restaurantName,
}: {
  /** Restaurante del panel abierto. Sin valor = el restaurante de este deployment. */
  restaurantId?: string;
  /** Prefijo de los links internos: "" en la raiz, "/<slug>" en el panel de un cliente. */
  basePath?: string;
  /** Nombre del negocio, para dejar claro de quien son los usuarios que se estan creando. */
  restaurantName?: string;
} = {}) {
  const users = await apiServerFetchScoped<AdminUserDTO[]>("/api/admin-users", restaurantId);

  return (
    <div>
      <h2>Usuarios</h2>
      <p className="muted" style={{ marginTop: -16, marginBottom: 8 }}>
        {restaurantName
          ? `Quienes entran al panel de ${restaurantName}. `
          : ""}
        Solo el administrador puede crear usuarios y decidir que secciones puede usar cada uno. Configuración y Usuarios son
        exclusivos del administrador.
      </p>
      {restaurantName && (
        // El dato que el dueño del negocio realmente necesita al recibir su acceso: donde
        // entrar. Su usuario cae solo en este panel, no puede salirse a otro restaurante.
        <p className="muted" style={{ marginTop: 0, marginBottom: 24, fontSize: "0.8125rem" }}>
          Estos usuarios inician sesión en <strong>/login</strong> y entran directo a este panel
          (<strong>{basePath || "/"}</strong>). No ven los datos de ningún otro negocio.
        </p>
      )}
      <UsersManager initialUsers={users} />
    </div>
  );
}
