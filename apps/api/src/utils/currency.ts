/** Formatea un monto en la moneda del negocio (BusinessSettings.currency, ej: COP, MXN, USD). */
export function formatCurrency(amount: number, currencyCode: string): string {
  const formatter = new Intl.NumberFormat("es-419", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 0,
  });
  return formatter.format(amount);
}
