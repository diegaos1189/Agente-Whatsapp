"use client";

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type DayHours = { open: string; close: string } | null;
export type OpeningHours = Partial<Record<DayKey, DayHours>>;

const DAYS: Array<{ key: DayKey; label: string }> = [
  { key: "mon", label: "Lunes" },
  { key: "tue", label: "Martes" },
  { key: "wed", label: "Miercoles" },
  { key: "thu", label: "Jueves" },
  { key: "fri", label: "Viernes" },
  { key: "sat", label: "Sabado" },
  { key: "sun", label: "Domingo" },
];

const DEFAULT_HOURS = { open: "11:00", close: "22:00" };

export function OpeningHoursEditor({
  value,
  onChange,
}: {
  value: OpeningHours;
  onChange: (next: OpeningHours) => void;
}) {
  function setDay(day: DayKey, hours: DayHours) {
    onChange({ ...value, [day]: hours });
  }

  function copyMondayToAll() {
    const monday = value.mon ?? DEFAULT_HOURS;
    const next: OpeningHours = {};
    for (const { key } of DAYS) next[key] = { ...monday };
    onChange(next);
  }

  return (
    <div>
      <div className="opening-hours-grid">
      {DAYS.map(({ key, label }) => {
        const hours = value[key];
        const isOpen = hours !== null && hours !== undefined;
        return (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, width: 130, flexDirection: "row" }}>
              <input
                type="checkbox"
                checked={isOpen}
                onChange={(e) => setDay(key, e.target.checked ? DEFAULT_HOURS : null)}
              />
              <span style={{ fontWeight: 500, fontSize: 13, color: "var(--text)" }}>{label}</span>
            </label>
            {isOpen ? (
              <>
                <input
                  type="time"
                  value={hours.open}
                  onChange={(e) => setDay(key, { ...hours, open: e.target.value })}
                  style={{ width: 110 }}
                />
                <span className="muted">a</span>
                <input
                  type="time"
                  value={hours.close}
                  onChange={(e) => setDay(key, { ...hours, close: e.target.value })}
                  style={{ width: 110 }}
                />
              </>
            ) : (
              <span className="muted">Cerrado</span>
            )}
          </div>
        );
      })}
      </div>
      <button type="button" className="secondary" onClick={copyMondayToAll} style={{ marginTop: 12 }}>
        Copiar horario del lunes a todos los dias
      </button>
    </div>
  );
}
