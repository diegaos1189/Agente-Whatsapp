/**
 * Restaurante sobre el que esta trabajando el panel en este momento (solo navegador).
 *
 * Las llamadas del cliente salen desde componentes hondos (el modal de producto, el form de
 * configuracion) que no reciben el restaurante por props. En vez de pasarlo a mano por diez
 * niveles, el layout de /<slug> lo registra aqui y apiClientFetch lo agrega como header.
 *
 * Vive en memoria del tab, no en localStorage: es el contexto de la pantalla abierta, no una
 * preferencia que deba sobrevivir a una recarga (al recargar, el layout lo vuelve a fijar).
 */
let activeRestaurantId: string | null = null;

/** null = panel del restaurante local (la API asume el local cuando no llega el header). */
export function setActiveRestaurantId(id: string | null): void {
  activeRestaurantId = id;
}

export function getActiveRestaurantId(): string | null {
  return activeRestaurantId;
}

/** Header con el que la API sabe sobre que restaurante aplica el request. */
export const RESTAURANT_HEADER = "x-restaurant-id";
