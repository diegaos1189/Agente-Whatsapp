import { RestaurantsManager } from "./RestaurantsManager";

export default function RestaurantesPage() {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Restaurantes</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          Negocios que usan la plataforma. Datos de demostración: todavía no hay backend.
        </p>
      </div>
      <RestaurantsManager />
    </div>
  );
}
