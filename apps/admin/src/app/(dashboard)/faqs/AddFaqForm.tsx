"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";

export function AddFaqForm() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiClientFetch("/faqs", { method: "POST", body: JSON.stringify({ question, answer }) });
      setQuestion("");
      setAnswer("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creando la pregunta frecuente");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card-form" onSubmit={handleSubmit}>
      <h4>Nueva pregunta frecuente</h4>
      <label>
        Pregunta
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ej: ¿Tienen parqueadero?" required />
      </label>
      <label>
        Respuesta
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} required />
      </label>
      {error && <div className="error-text">{error}</div>}
      <button type="submit" className="cta" disabled={saving || !question.trim() || !answer.trim()}>
        {saving ? "Creando..." : "Crear"}
      </button>
    </form>
  );
}
