import { apiServerFetch } from "@/lib/apiServer";
import type { FaqDTO } from "@pollos/shared";
import { AddFaqForm } from "./AddFaqForm";
import { FaqRow } from "./FaqRow";

export default async function FaqsPage() {
  const faqs = await apiServerFetch<FaqDTO[]>("/api/faqs");

  return (
    <div>
      <h2>Preguntas frecuentes</h2>
      <p className="muted" style={{ marginTop: -12 }}>
        El agente responde con estas respuestas exactas cuando el cliente pregunta algo parecido y no encuentra otra
        forma de responder (nunca inventa la respuesta).
      </p>

      <div style={{ marginBottom: 24 }}>
        <AddFaqForm />
      </div>

      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Pregunta</th>
            <th>Respuesta</th>
            <th>Activa</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {faqs.map((f) => (
            <FaqRow key={f.id} faq={f} />
          ))}
          {faqs.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                Aún no hay preguntas frecuentes.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
