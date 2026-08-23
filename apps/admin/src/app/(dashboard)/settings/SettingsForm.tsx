"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { BusinessSettingsDTO } from "@pollos/shared";
import { OpeningHoursEditor, type OpeningHours } from "./OpeningHoursEditor";
import { TransferAccountsEditor } from "./TransferAccountsEditor";

const LOGO_MAX_SIZE = 400;

/** Redimensiona la imagen a maximo 400x400 (conserva proporcion) antes de convertirla a
 * data URL — evita subir fotos de varios MB tal cual (rebota con "cuerpo muy grande") y de
 * paso deja el logo en el tamano que realmente se usa en el panel. */
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

function buildFormState(settings: BusinessSettingsDTO) {
  return {
    restaurantName: settings.restaurantName,
    logoUrl: settings.logoUrl,
    phone: settings.phone,
    address: settings.address,
    currency: settings.currency,
    deliveryFee: settings.deliveryFee,
    estimatedPrepMinutes: settings.estimatedPrepMinutes,
    acceptsScheduledOrders: settings.acceptsScheduledOrders,
    upsellEnabled: settings.upsellEnabled,
    maxUpsellOffers: settings.maxUpsellOffers,
    acceptedPaymentMethods: settings.acceptedPaymentMethods,
    transferAccounts: settings.transferAccounts,
    dailyArchiveTime: settings.dailyArchiveTime,
    outOfHoursMessage: settings.outOfHoursMessage,
    welcomeMessage: settings.welcomeMessage,
    assistantTone: settings.assistantTone,
    agentName: settings.agentName,
    whatsappProvider: settings.whatsappProvider,
    whatsappPhoneNumberId: settings.whatsappPhoneNumberId,
    whatsappToken: settings.whatsappToken,
    whatsappAppSecret: settings.whatsappAppSecret,
    whatsappVerifyToken: settings.whatsappVerifyToken,
    whatsappApiVersion: settings.whatsappApiVersion,
    reactivationEnabled: settings.reactivationEnabled,
    reactivationTemplateName: settings.reactivationTemplateName,
    reactivationTemplateLanguage: settings.reactivationTemplateLanguage,
    reactivationDormantDays: settings.reactivationDormantDays,
    reactivationCooldownDays: settings.reactivationCooldownDays,
  };
}

export function SettingsForm({ settings, summaryPanel }: { settings: BusinessSettingsDTO; summaryPanel?: ReactNode }) {
  const router = useRouter();
  const [initialForm, setInitialForm] = useState(buildFormState(settings));
  const [initialHours, setInitialHours] = useState(settings.openingHours);
  const [form, setForm] = useState(initialForm);
  const [openingHours, setOpeningHours] = useState<OpeningHours>(initialHours);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isDirty =
    JSON.stringify(form) !== JSON.stringify(initialForm) || JSON.stringify(openingHours) !== JSON.stringify(initialHours);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.acceptedPaymentMethods.length === 0) {
      setError("Debes dejar al menos un metodo de pago habilitado.");
      return;
    }
    if (form.transferAccounts.some((acc) => !acc.bankName.trim() || !acc.accountInfo.trim())) {
      setError("Completa el banco y el numero de cuenta/llave de cada cuenta de transferencia, o quitala.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiClientFetch("/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          deliveryFee: Number(form.deliveryFee),
          estimatedPrepMinutes: Number(form.estimatedPrepMinutes),
          maxUpsellOffers: Number(form.maxUpsellOffers),
          reactivationDormantDays: Number(form.reactivationDormantDays),
          reactivationCooldownDays: Number(form.reactivationCooldownDays),
          openingHours,
        }),
      });
      setInitialForm(form);
      setInitialHours(openingHours);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar la configuración");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="settings-grid">
        <div className="settings-column">
          {summaryPanel}
          <section className="settings-section">
          <h3>Datos del negocio</h3>
            <label>
              Nombre del negocio
              <input value={form.restaurantName} onChange={(e) => setForm({ ...form, restaurantName: e.target.value })} />
            </label>
            <label>
              Logo (se muestra arriba del menú del panel)
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {form.logoUrl && (
                  <img src={form.logoUrl} alt="Logo" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "contain", border: "1px solid var(--border)" }} />
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const dataUrl = await resizeImageToDataUrl(file, LOGO_MAX_SIZE);
                      setForm({ ...form, logoUrl: dataUrl });
                    } catch {
                      setError("No se pudo procesar la imagen del logo. Intenta con otro archivo.");
                    }
                  }}
                />
                {form.logoUrl && (
                  <button type="button" className="secondary" onClick={() => setForm({ ...form, logoUrl: null })}>
                    Quitar
                  </button>
                )}
              </div>
            </label>
            <label>
              Teléfono
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label>
              Dirección
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </label>
            <label>
              Moneda (código ISO: COP, MXN, USD, etc)
              <input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                maxLength={3}
                style={{ width: 100 }}
              />
            </label>
          </section>
        </div>

          <section className="settings-section">
            <h3>Operación</h3>
            <label>
              Costo de domicilio
              <input
                type="number"
                value={form.deliveryFee}
                onChange={(e) => setForm({ ...form, deliveryFee: Number(e.target.value) })}
              />
            </label>
            <label>
              Tiempo estimado de preparación (minutos)
              <input
                type="number"
                value={form.estimatedPrepMinutes}
                onChange={(e) => setForm({ ...form, estimatedPrepMinutes: Number(e.target.value) })}
              />
            </label>
            <label>
              Hora de archivo automático de chats del día
              <input
                type="time"
                value={form.dailyArchiveTime}
                onChange={(e) => setForm({ ...form, dailyArchiveTime: e.target.value })}
                style={{ width: 130 }}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
              <input
                type="checkbox"
                checked={form.acceptsScheduledOrders}
                onChange={(e) => setForm({ ...form, acceptsScheduledOrders: e.target.checked })}
              />
              Acepta pedidos programados fuera de horario
            </label>
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Metodos de pago aceptados</div>
              {[
                { value: "CASH", label: "Efectivo" },
                { value: "TRANSFER", label: "Transferencia" },
                { value: "CARD_ON_DELIVERY", label: "Tarjeta contraentrega" },
              ].map((m) => (
                <label key={m.value} style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
                  <input
                    type="checkbox"
                    checked={form.acceptedPaymentMethods.includes(m.value)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        acceptedPaymentMethods: e.target.checked
                          ? [...form.acceptedPaymentMethods, m.value]
                          : form.acceptedPaymentMethods.filter((v) => v !== m.value),
                      })
                    }
                  />
                  {m.label}
                </label>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Upsell / adicionales sugeridos</div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
                <input
                  type="checkbox"
                  checked={form.upsellEnabled}
                  onChange={(e) => setForm({ ...form, upsellEnabled: e.target.checked })}
                />
                Activar sugerencias de adicionales durante el pedido (ver Recomendaciones)
              </label>
              {form.upsellEnabled && (
                <label style={{ marginTop: 6, maxWidth: 220 }}>
                  Maximo de ofertas por pedido
                  <input
                    type="number"
                    min={0}
                    max={3}
                    value={form.maxUpsellOffers}
                    onChange={(e) => setForm({ ...form, maxUpsellOffers: Number(e.target.value) })}
                  />
                </label>
              )}
            </div>
            <div style={{ marginTop: 4 }}>
              {form.acceptedPaymentMethods.includes("TRANSFER") && (
                <div style={{ marginTop: 10, paddingLeft: 4 }}>
                  <TransferAccountsEditor
                    value={form.transferAccounts}
                    onChange={(transferAccounts) => setForm({ ...form, transferAccounts })}
                  />
                  <button type="submit" className="save-btn" disabled={saving || !isDirty} style={{ marginTop: 10 }}>
                    {saving ? "Guardando..." : "Guardar cuentas de transferencia"}
                  </button>
                  {saved && <span className="save-success" style={{ marginLeft: 10 }}>✓ Guardado</span>}
                </div>
              )}
            </div>
          </section>
      </div>

      <section className="settings-section settings-full">
        <h3>Horario de atención</h3>
        <OpeningHoursEditor value={openingHours} onChange={setOpeningHours} />
      </section>

      <section className="settings-section settings-full">
        <h3>Mensajes y personalidad</h3>
        <label style={{ marginBottom: 12, display: "block" }}>
          Nombre del agente (ej: Sara)
          <input
            value={form.agentName}
            onChange={(e) => setForm({ ...form, agentName: e.target.value })}
            placeholder="Ej: Sara"
            style={{ maxWidth: 260 }}
          />
        </label>
        <p className="muted" style={{ marginTop: -8, marginBottom: 12, fontSize: 12 }}>
          El saludo inicial siempre sigue el mismo formato: "Hola, bienvenido a {"{negocio}"}, me llamo {"{"}
          {form.agentName || "..."}
          {"}"}. ¿En qué te ayudo hoy?" + el menú numerado (Ver menú / Hacer pedido / Promociones / Estado). No hace falta
          escribirlo a mano.
        </p>
        <div className="settings-fields-row">
          <label>
            Personalidad / tono del asistente
            <textarea
              rows={4}
              value={form.assistantTone}
              onChange={(e) => setForm({ ...form, assistantTone: e.target.value })}
              placeholder="Ej: cálido y cercano, con humor ligero / formal y directo, sin nada de humor"
            />
          </label>
          <label>
            Mensaje de bienvenida (opcional)
            <textarea
              rows={4}
              value={form.welcomeMessage}
              onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })}
              placeholder="Si lo dejas vacío se usa el saludo por defecto (nombre del negocio + menú numerado). Si escribes algo aquí, se manda TAL CUAL como saludo completo — incluye vos el menú si lo quieres."
            />
          </label>
          <label>
            Mensaje fuera de horario
            <textarea rows={4} value={form.outOfHoursMessage} onChange={(e) => setForm({ ...form, outOfHoursMessage: e.target.value })} />
          </label>
        </div>
      </section>

      <section className="settings-section settings-full">
        <h3>Campanas seguras WhatsApp</h3>
        <p className="muted" style={{ marginTop: -8, marginBottom: 12, fontSize: 13 }}>
          Estas campanas solo deben usarse con clientes que dieron permiso para recibir promociones. Cuando el proveedor
          es Meta, se enviaran unicamente mediante plantilla aprobada.
        </p>
        <div className="settings-fields-row">
          <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
            <input
              type="checkbox"
              checked={form.reactivationEnabled}
              onChange={(e) => setForm({ ...form, reactivationEnabled: e.target.checked })}
            />
            Activar reactivacion automatica de clientes dormidos
          </label>
          <label>
            Nombre de plantilla aprobada en Meta
            <input
              value={form.reactivationTemplateName}
              onChange={(e) => setForm({ ...form, reactivationTemplateName: e.target.value })}
              placeholder="Ej: cliente_dormido_vuelve_hoy"
            />
          </label>
          <label>
            Idioma de plantilla
            <input
              value={form.reactivationTemplateLanguage}
              onChange={(e) => setForm({ ...form, reactivationTemplateLanguage: e.target.value })}
              placeholder="es_CO"
              style={{ width: 120 }}
            />
          </label>
        </div>
        <div className="settings-fields-row">
          <label>
            Dias para considerar cliente dormido
            <input
              type="number"
              min={7}
              max={180}
              value={form.reactivationDormantDays}
              onChange={(e) => setForm({ ...form, reactivationDormantDays: Number(e.target.value) })}
            />
          </label>
          <label>
            Cooldown entre campanas al mismo cliente
            <input
              type="number"
              min={7}
              max={180}
              value={form.reactivationCooldownDays}
              onChange={(e) => setForm({ ...form, reactivationCooldownDays: Number(e.target.value) })}
            />
          </label>
        </div>
      </section>

      <section className="settings-section settings-full">
        <h3>WhatsApp API</h3>
        <p className="muted" style={{ marginTop: -8, marginBottom: 12, fontSize: 13 }}>
          Credenciales de la cuenta de WhatsApp Cloud API de este negocio. Cambia el token aqui cuando Meta lo renueve —
          no hace falta editar archivos ni reiniciar el servidor, el siguiente mensaje ya usa el valor nuevo.
        </p>
        <div className="settings-fields-row">
          <label>
            Proveedor
            <select
              value={form.whatsappProvider}
              onChange={(e) => setForm({ ...form, whatsappProvider: e.target.value })}
            >
              <option value="mock">Mock (pruebas, no envia WhatsApp real)</option>
              <option value="meta">Meta WhatsApp Cloud API (real)</option>
            </select>
          </label>
          <label>
            Phone Number ID
            <input
              value={form.whatsappPhoneNumberId}
              onChange={(e) => setForm({ ...form, whatsappPhoneNumberId: e.target.value })}
              placeholder="Ej: 1299726816551246"
            />
          </label>
          <label>
            Version de API
            <input
              value={form.whatsappApiVersion}
              onChange={(e) => setForm({ ...form, whatsappApiVersion: e.target.value })}
              placeholder="v21.0"
              style={{ width: 100 }}
            />
          </label>
        </div>
        <div className="settings-fields-row">
          <label>
            Token de acceso
            <input
              type="password"
              value={form.whatsappToken}
              onFocus={() => {
                if (form.whatsappToken.startsWith("••••")) setForm({ ...form, whatsappToken: "" });
              }}
              onChange={(e) => setForm({ ...form, whatsappToken: e.target.value })}
              placeholder="Pega el token nuevo para reemplazarlo"
            />
          </label>
          <label>
            App Secret
            <input
              type="password"
              value={form.whatsappAppSecret}
              onFocus={() => {
                if (form.whatsappAppSecret.startsWith("••••")) setForm({ ...form, whatsappAppSecret: "" });
              }}
              onChange={(e) => setForm({ ...form, whatsappAppSecret: e.target.value })}
              placeholder="Pega el app secret nuevo para reemplazarlo"
            />
          </label>
          <label>
            Verify Token
            <input
              type="password"
              value={form.whatsappVerifyToken}
              onFocus={() => {
                if (form.whatsappVerifyToken.startsWith("••••")) setForm({ ...form, whatsappVerifyToken: "" });
              }}
              onChange={(e) => setForm({ ...form, whatsappVerifyToken: e.target.value })}
              placeholder="El que configuraste en el panel de Meta"
            />
          </label>
        </div>
      </section>

      {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}
      <div className="settings-actions" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button type="submit" className="save-btn" disabled={saving || !isDirty}>
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
        {saved && <span className="save-success">✓ Guardado exitosamente</span>}
      </div>
    </form>
  );
}
