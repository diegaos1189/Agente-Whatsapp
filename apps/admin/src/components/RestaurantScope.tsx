"use client";

import { useEffect } from "react";
import { setActiveRestaurantId } from "@/lib/restaurantScope";

/**
 * Registra el restaurante del panel /<slug> para que las llamadas del navegador salgan
 * acotadas a el (ver restaurantScope.ts).
 *
 * Se fija durante el render y no en el efecto: un click puede disparar un fetch antes de que
 * corran los efectos, y ese primer request tiene que ir con el restaurante correcto. El
 * efecto solo se encarga de limpiarlo al salir del panel, para que volver al panel local no
 * arrastre el restaurante anterior.
 */
export function RestaurantScope({ restaurantId }: { restaurantId: string }) {
  setActiveRestaurantId(restaurantId);

  useEffect(() => {
    setActiveRestaurantId(restaurantId);
    return () => setActiveRestaurantId(null);
  }, [restaurantId]);

  return null;
}
