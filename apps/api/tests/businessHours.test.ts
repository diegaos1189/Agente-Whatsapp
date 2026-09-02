import { describe, expect, it } from "vitest";
import { checkIsOpen } from "../src/modules/business/businessHoursService.js";
import type { BusinessSettingsDTO } from "@pollos/shared";

const baseSettings: BusinessSettingsDTO = {
  id: "1",
  restaurantId: "local-deployment",
  restaurantName: "Pollos El Corralito",
  phone: "+57 300 000 0000",
  address: "Cra 10",
  currency: "COP",
  timezone: "America/Bogota",
  openingHours: {
    mon: { open: "11:00", close: "22:00" },
    tue: { open: "11:00", close: "22:00" },
    wed: { open: "11:00", close: "22:00" },
    thu: { open: "11:00", close: "22:00" },
    fri: { open: "11:00", close: "22:00" },
    sat: { open: "11:00", close: "22:00" },
    sun: null,
  },
  deliveryFee: 5000,
  estimatedPrepMinutes: 30,
  acceptsScheduledOrders: true,
  outOfHoursMessage: "Cerrado",
  welcomeMessage: "Hola",
};

describe("checkIsOpen", () => {
  it("esta abierto un martes a mediodia dentro del horario", () => {
    const tuesdayNoon = new Date("2026-08-04T17:00:00.000Z"); // ~12:00 America/Bogota (UTC-5)
    const result = checkIsOpen(baseSettings, tuesdayNoon);
    expect(result.isOpen).toBe(true);
  });

  it("esta cerrado un martes a las 3am", () => {
    const tuesdayEarly = new Date("2026-08-04T08:00:00.000Z"); // ~03:00 America/Bogota
    const result = checkIsOpen(baseSettings, tuesdayEarly);
    expect(result.isOpen).toBe(false);
  });

  it("esta cerrado todo el domingo si openingHours.sun es null", () => {
    const sundayNoon = new Date("2026-08-02T17:00:00.000Z");
    const result = checkIsOpen(baseSettings, sundayNoon);
    expect(result.isOpen).toBe(false);
    expect(result.todayHours).toBeNull();
  });
});
