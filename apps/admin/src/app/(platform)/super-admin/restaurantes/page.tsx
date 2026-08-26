import { RestaurantsManager } from "./RestaurantsManager";

export default function RestaurantesPage() {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Restaurantes</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          Negocios que usan la plataforma. Todavía no hay backend: los datos se guardan en este navegador.
        </p>
      </div>
      <RestaurantsManager />
    </div>
  );
}
