export const ADMIN_ROLE = "ADMIN";
export const STAFF_ROLE = "STAFF";

export const PERMISSION_KEYS = [
  "metrics",
  "conversations",
  "orders",
  "products",
  "promotions",
  "faqs",
  "kitchen",
  "facturacion",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type AdminRole = typeof ADMIN_ROLE | typeof STAFF_ROLE;
