"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";

const MAX_IMAGES = 5;
const IMAGE_MAX_SIZE = 1280;

/** Redimensiona la imagen a maximo 1280px (conserva proporcion) antes de convertirla a data
 * URL — evita mandar fotos de varios MB tal cual al guardar o al mandarlas por WhatsApp. */
function resizeImageToDataUrl(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo procesar la imagen"));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("No se pudo procesar la imagen"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function MenuImagesEditor({ menuImages }: { menuImages: string[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState(menuImages);
  const [images, setImages] = useState(menuImages);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const isDirty = JSON.stringify(images) !== JSON.stringify(saved);

  async function handleAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (images.length >= MAX_IMAGES) {
      setError(`Maximo ${MAX_IMAGES} fotos del menu`);
      return;
    }
    setError(null);
    setJustSaved(false);
    try {
      const dataUrl = await resizeImageToDataUrl(file, IMAGE_MAX_SIZE);
      setImages((prev) => [...prev, dataUrl]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo procesar la imagen");
    }
  }

  function handleRemove(index: number) {
    setError(null);
    setJustSaved(false);
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await apiClientFetch("/settings", { method: "PUT", body: JSON.stringify({ menuImages: images }) });
      setSaved(images);
      setJustSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar las fotos del menu");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        background: "var(--surface-solid)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 16,
        boxShadow: "var(--shadow-card)",
      }}
    >
      <h4 style={{ marginTop: 0 }}>Fotos del menú ({images.length}/{MAX_IMAGES})</h4>
      <p className="muted" style={{ marginTop: -6, fontSize: 12, marginBottom: 12 }}>
        El agente manda estas fotos por WhatsApp cuando el cliente pide ver el menú, antes de la
        lista de categorías. Agrega o quita las que quieras y dale <strong>Guardar</strong> al final.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {images.map((src, i) => (
          <div key={i} style={{ position: "relative" }}>
            <img
              src={src}
              alt={`Foto del menú ${i + 1}`}
              style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
            />
            <button
              type="button"
              className="danger"
              onClick={() => handleRemove(i)}
              disabled={saving}
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                width: 22,
                height: 22,
                padding: 0,
                borderRadius: "50%",
                fontSize: 12,
                lineHeight: "22px",
              }}
              title="Quitar"
            >
              ✕
            </button>
          </div>
        ))}
        {images.length < MAX_IMAGES && (
          <label
            style={{
              width: 84,
              height: 84,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px dashed var(--border)",
              borderRadius: 8,
              cursor: saving ? "default" : "pointer",
              fontSize: 12,
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            + Agregar
            <input type="file" accept="image/*" onChange={handleAdd} disabled={saving} style={{ display: "none" }} />
          </label>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button type="button" className="cta" onClick={handleSave} disabled={saving || !isDirty}>
          {saving ? "Guardando..." : "Guardar"}
        </button>
        {!isDirty && justSaved && <span className="muted" style={{ fontSize: 12 }}>Guardado ✓</span>}
        {isDirty && <span className="muted" style={{ fontSize: 12 }}>Tienes cambios sin guardar</span>}
      </div>
      {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
