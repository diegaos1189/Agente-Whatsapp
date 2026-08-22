export const DAY_LABELS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];

export function formatDaysOfWeek(daysOfWeek: number[]): string {
  if (daysOfWeek.length === 0) return "Todos los días";
  return DAY_LABELS.filter((d) => daysOfWeek.includes(d.value))
    .map((d) => d.label)
    .join(", ");
}
