import { apiServerFetch } from "@/lib/apiServer";
import type { BusinessSettingsDTO } from "@pollos/shared";

const DAY_LABELS_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function waLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

async function getSettings(): Promise<BusinessSettingsDTO | null> {
  try {
    return await apiServerFetch<BusinessSettingsDTO>("/api/settings");
  } catch {
    return null;
  }
}

export default async function LandingPage() {
  const settings = await getSettings();
  const name = settings?.restaurantName ?? "Nuestro negocio";
  const phone = settings?.phone ?? "";
  const address = settings?.address ?? "";
  const logoUrl = settings?.logoUrl ?? null;
  const greetingText = `Hola, quiero hacer un pedido en ${name}`;
  const chatLink = phone ? waLink(phone, greetingText) : "#";
  const todayKey = DAY_KEYS[new Date().getDay()];
  const todayHours = settings?.openingHours?.[todayKey ?? ""] ?? null;

  return (
    <div style={{ background: "#ffffff", color: "#252527", minHeight: "100vh" }}>
      {/* Navbar */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 32px",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {logoUrl && (
            <img src={logoUrl} alt={name} style={{ width: 36, height: 36, borderRadius: 8, objectFit: "contain" }} />
          )}
          <span style={{ fontWeight: 700, fontSize: "1.125rem" }}>{name}</span>
        </div>
        <a
          href={chatLink}
          style={{
            background: "linear-gradient(135deg, #3fbf25, #2a8f17)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 14,
            padding: "10px 20px",
            borderRadius: 999,
            textDecoration: "none",
            boxShadow: "0 4px 14px rgba(49,167,27,0.35)",
          }}
        >
          Pedir por WhatsApp
        </a>
      </header>

      {/* Hero */}
      <section
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 48,
          padding: "64px 32px",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <div style={{ flex: "1 1 420px", minWidth: 300 }}>
          <span
            style={{
              display: "inline-block",
              background: "#eaf6e8",
              color: "#2a8f17",
              fontSize: 12,
              fontWeight: 700,
              padding: "5px 12px",
              borderRadius: 999,
              marginBottom: 18,
            }}
          >
            Pedidos por WhatsApp
          </span>
          <h1 style={{ fontSize: "2.5rem", lineHeight: 1.15, margin: "0 0 16px", fontWeight: 800 }}>
            Pide en <span style={{ color: "#31a71b" }}>{name}</span> directo por WhatsApp
          </h1>
          <p style={{ color: "#4d4c52", fontSize: "1.0625rem", lineHeight: 1.6, margin: "0 0 28px", maxWidth: 440 }}>
            Escríbenos, arma tu pedido con nuestro asistente y recíbelo en tu casa o recógelo en el local. Sin
            apps, sin registros — solo WhatsApp.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a
              href={chatLink}
              style={{
                background: "linear-gradient(135deg, #3fbf25, #2a8f17)",
                color: "#fff",
                fontWeight: 700,
                fontSize: 15,
                padding: "13px 26px",
                borderRadius: 999,
                textDecoration: "none",
                boxShadow: "0 4px 14px rgba(49,167,27,0.35)",
              }}
            >
              Escribir por WhatsApp
            </a>
            <a
              href="#como-funciona"
              style={{
                border: "1.5px solid #31a71b",
                color: "#2a8f17",
                fontWeight: 700,
                fontSize: 15,
                padding: "12px 26px",
                borderRadius: 999,
                textDecoration: "none",
              }}
            >
              Cómo funciona
            </a>
          </div>
        </div>

        {/* Phone mockup */}
        <div style={{ flex: "1 1 320px", minWidth: 280, display: "flex", justifyContent: "center" }}>
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                inset: "10% -10% -10% 10%",
                background: "radial-gradient(circle, #31a71b 0%, rgba(49,167,27,0) 70%)",
                opacity: 0.25,
                zIndex: 0,
              }}
            />
            <div
              style={{
                position: "relative",
                zIndex: 1,
                width: 280,
                background: "#0b0d0a",
                borderRadius: 32,
                padding: 10,
                boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              }}
            >
              <div style={{ background: "#e5ddd5", borderRadius: 22, padding: 14, minHeight: 380, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ background: "#075e54", margin: "-14px -14px 8px", padding: "10px 14px", borderRadius: "22px 22px 0 0", color: "#fff", fontSize: 13, fontWeight: 700 }}>
                  {name}
                </div>
                <div style={{ alignSelf: "flex-start", background: "#fff", borderRadius: 8, borderTopLeftRadius: 0, padding: "7px 10px", fontSize: 12.5, maxWidth: "85%" }}>
                  Hola, quiero un pedido para hoy 🙂
                </div>
                <div style={{ alignSelf: "flex-end", background: "#d9fdd3", borderRadius: 8, borderTopRightRadius: 0, padding: "7px 10px", fontSize: 12.5, maxWidth: "85%" }}>
                  ¡Claro! Este es nuestro menú del día, ¿qué te provoca?
                </div>
                <div style={{ alignSelf: "flex-start", background: "#fff", borderRadius: 8, borderTopLeftRadius: 0, padding: "7px 10px", fontSize: 12.5, maxWidth: "85%" }}>
                  Deme el combo familiar
                </div>
                <div style={{ alignSelf: "flex-end", background: "#d9fdd3", borderRadius: 8, borderTopRightRadius: 0, padding: "7px 10px", fontSize: 12.5, maxWidth: "85%" }}>
                  Listo 👌 ¿Domicilio o recoges en el local?
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" style={{ background: "#fffbec", padding: "56px 32px" }}>
        <h2 style={{ textAlign: "center", fontSize: "1.75rem", fontWeight: 800, margin: "0 0 40px" }}>
          Pedir en {name} es así de fácil
        </h2>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", justifyContent: "center", maxWidth: 900, margin: "0 auto" }}>
          {[
            { step: "1", title: "Escríbenos por WhatsApp", text: "Toca el botón y empieza la conversación, sin descargar nada." },
            { step: "2", title: "Arma tu pedido", text: "Nuestro asistente te muestra el menú y arma tu pedido contigo." },
            { step: "3", title: "Recíbelo", text: "A domicilio o recógelo en el local, como prefieras." },
          ].map((s) => (
            <div key={s.step} style={{ flex: "1 1 220px", maxWidth: 260, textAlign: "center" }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "#eaf6e8",
                  color: "#2a8f17",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontSize: 20,
                  margin: "0 auto 14px",
                }}
              >
                {s.step}
              </div>
              <h3 style={{ fontSize: "1.0625rem", margin: "0 0 6px" }}>{s.title}</h3>
              <p style={{ color: "#4d4c52", fontSize: 13.5, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Info strip */}
      <section style={{ padding: "48px 32px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {todayHours && (
            <div style={{ flex: "1 1 220px", background: "#eaf6e8", borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#2a8f17", textTransform: "uppercase", marginBottom: 6 }}>
                Horario de hoy ({DAY_LABELS_ES[new Date().getDay()]})
              </div>
              <div style={{ fontSize: "1.0625rem", fontWeight: 700 }}>
                {todayHours.open} – {todayHours.close}
              </div>
            </div>
          )}
          {address && (
            <div style={{ flex: "1 1 220px", background: "#eaf6e8", borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#2a8f17", textTransform: "uppercase", marginBottom: 6 }}>
                Dirección
              </div>
              <div style={{ fontSize: "1.0625rem", fontWeight: 700 }}>{address}</div>
            </div>
          )}
          {settings?.acceptsDelivery && (
            <div style={{ flex: "1 1 220px", background: "#eaf6e8", borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#2a8f17", textTransform: "uppercase", marginBottom: 6 }}>
                Domicilio
              </div>
              <div style={{ fontSize: "1.0625rem", fontWeight: 700 }}>Disponible en tu zona</div>
            </div>
          )}
        </div>
      </section>

      {/* CTA final */}
      <section
        style={{
          background: "linear-gradient(135deg, #3fbf25, #2a8f17)",
          color: "#fff",
          padding: "56px 32px",
          textAlign: "center",
        }}
      >
        <h2 style={{ fontSize: "1.75rem", fontWeight: 800, margin: "0 0 12px" }}>¿Se te antojó algo?</h2>
        <p style={{ opacity: 0.9, margin: "0 0 24px" }}>Escríbenos ahora y en minutos tienes tu pedido en camino.</p>
        <a
          href={chatLink}
          style={{
            display: "inline-block",
            background: "#fff",
            color: "#2a8f17",
            fontWeight: 800,
            fontSize: 15,
            padding: "13px 28px",
            borderRadius: 999,
            textDecoration: "none",
          }}
        >
          Escribir por WhatsApp
        </a>
      </section>

      <footer style={{ padding: "24px 32px", textAlign: "center", color: "#4d4c52", fontSize: 12.5 }}>
        {name}
        {phone ? ` · ${phone}` : ""}
      </footer>
    </div>
  );
}
