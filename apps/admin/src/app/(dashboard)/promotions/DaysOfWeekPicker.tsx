"use client";

import { DAY_LABELS } from "./dayLabels";

export function DaysOfWeekPicker({ value, onChange }: { value: number[]; onChange: (next: number[]) => void }) {
  function toggle(day: number) {
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day]);
  }

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Días en que aplica (ninguno marcado = todos los días)</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {DAY_LABELS.map((d) => (
          <button
            type="button"
            key={d.value}
            className={value.includes(d.value) ? "cta" : "secondary"}
            onClick={() => toggle(d.value)}
            style={{ padding: "4px 10px", fontSize: 12 }}
          >
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
}
