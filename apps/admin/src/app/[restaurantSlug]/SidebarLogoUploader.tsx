"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClientFetch } from "@/lib/apiClient";

const LOGO_MAX_SIZE = 512;

/**
 * Redimensiona a maximo 512px antes de convertir a data URL. El logo se guarda inline en
 * business_settings (este template no tiene bucket de archivos), asi que subir un JPG de
 * varios MB tal cual engordaria cada lectura de la configuracion.
 */
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
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Logo del restaurante, subible desde la propia barra lateral.
 *
 * El campo tambien vive en Configuracion, pero cargar el logo es de las primeras cosas que
 * se hacen con un cliente nuevo y ahi arriba es donde se nota que falta: se ve el hueco y se
 * hace click. Guarda directo (no hay boton "Guardar") porque es un solo dato y el resultado
 * se ve al instante en el mismo lugar donde se toco.
 */
export function SidebarLogoUploader({ logoUrl, restaurantName }: { logoUrl: string | null; restaurantName: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(logoUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setSaving(true);
    const previous = preview;
    try {
      const dataUrl = await resizeImageToDataUrl(file, LOGO_MAX_SIZE);
      // Optimista: la imagen aparece apenas se procesa, sin esperar al guardado.
      setPreview(dataUrl);
      await apiClientFetch("/settings", { method: "PUT", body: JSON.stringify({ logoUrl: dataUrl }) });
      router.refresh();
    } catch (err) {
      setPreview(previous);
      setError(err instanceof Error ? err.message : "No se pudo guardar el logo");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setError(null);
    setSaving(true);
    const previous = preview;
    try {
      setPreview(null);
      await apiClientFetch("/settings", { method: "PUT", body: JSON.stringify({ logoUrl: null }) });
      router.refresh();
    } catch (err) {
      setPreview(previous);
      setError(err instanceof Error ? err.message : "No se pudo quitar el logo");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sidebar-logo-uploader">
      <button
        type="button"
        className="sidebar-logo-button"
        onClick={() => inputRef.current?.click()}
        disabled={saving}
        aria-label={preview ? `Cambiar el logo de ${restaurantName}` : `Subir el logo de ${restaurantName}`}
        title={preview ? "Cambiar el logo" : "Subir el logo"}
      >
        {preview ? (
          <>
            <img src={preview} alt="" className="sidebar-logo" />
            <span className="sidebar-logo-overlay" aria-hidden="true">
              Cambiar
            </span>
          </>
        ) : (
          <span className="sidebar-logo-empty">
            <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>
              +
            </span>
            <span>Subir logo</span>
          </span>
        )}
      </button>

      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} hidden disabled={saving} />

      {saving && <span className="sidebar-logo-hint">Guardando…</span>}
      {!saving && preview && (
        <button type="button" className="sidebar-logo-remove" onClick={handleRemove}>
          Quitar logo
        </button>
      )}
      {error && (
        <span className="sidebar-logo-hint" role="alert" style={{ color: "var(--danger, #c0392b)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
