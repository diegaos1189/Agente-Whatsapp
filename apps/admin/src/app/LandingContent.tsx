const PRODUCT_NAME = "Pedix";
const CONTACT_EMAIL = "contacto@kenzygroup.co";
const DEMO_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Quiero una demo de ${PRODUCT_NAME}`)}`;

const FEATURE_GROUPS: Array<{
  title: string;
  items: Array<{ title: string; text: string }>;
}> = [
  {
    title: "Atención al cliente",
    items: [
      {
        title: "Agente de WhatsApp con IA",
        text: "Responde pedidos, dudas del menú y horarios 24/7, con el tono de tu negocio.",
      },
      {
        title: "Recomendaciones y upsell",
        text: "El agente sugiere combos y acompañantes en el momento justo, sin ser invasivo.",
      },
      {
        title: "CRM de conversaciones",
        text: "Bandeja tipo WhatsApp con historial completo por cliente y traspaso a un humano cuando hace falta.",
      },
    ],
  },
  {
    title: "Operación",
    items: [
      {
        title: "Gestión de pedidos en tiempo real",
        text: "Estados de pago, cocina, despacho y entrega, con alertas cuando un pedido se atasca.",
      },
      {
        title: "Pantalla de cocina",
        text: "Vista dedicada para el equipo de cocina: pedidos entrantes y un clic para marcar listo.",
      },
      {
        title: "Catálogo y combos",
        text: "Categorías, productos, modificadores y precios, editables sin tocar código.",
      },
      {
        title: "Cobros y conciliación",
        text: "Efectivo, transferencia y tarjeta, con seguimiento de pagos, reembolsos y saldos pendientes.",
      },
    ],
  },
  {
    title: "Crecimiento",
    items: [
      {
        title: "Recuperación de carritos",
        text: "Si un cliente arma un pedido y no lo termina, el agente le escribe para retomarlo.",
      },
      {
        title: "Campañas de reactivación",
        text: "Detecta clientes que dejaron de pedir y les manda una campaña automática por WhatsApp.",
      },
      {
        title: "Métricas y analítica",
        text: "Ventas, productos más vendidos, horas pico, segmentación de clientes y tiempos de operación.",
      },
      {
        title: "Roles y permisos por equipo",
        text: "Cocina, ventas y administración, cada quien con acceso solo a lo que necesita.",
      },
    ],
  },
];

const STEPS = [
  { step: "1", title: "Conecta tu WhatsApp", text: "Vinculamos el número oficial de tu negocio a la plataforma." },
  { step: "2", title: "Configura tu menú", text: "Cargas categorías, productos y precios desde el panel — sin código." },
  { step: "3", title: "Empieza a vender", text: "El agente atiende, cobra y organiza — tú ves todo desde un solo panel." },
];

export function LandingContent() {
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
        <span style={{ fontWeight: 800, fontSize: "1.25rem", color: "#2a8f17" }}>{PRODUCT_NAME}</span>
        <a
          href={DEMO_MAILTO}
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
          Solicita una demo
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
            Agente de WhatsApp + CRM + POS
          </span>
          <h1 style={{ fontSize: "2.5rem", lineHeight: 1.15, margin: "0 0 16px", fontWeight: 800 }}>
            El agente de WhatsApp con IA que atiende, vende y organiza tu negocio de comida
          </h1>
          <p style={{ color: "#4d4c52", fontSize: "1.0625rem", lineHeight: 1.6, margin: "0 0 28px", maxWidth: 460 }}>
            {PRODUCT_NAME} conecta tu WhatsApp con inteligencia artificial: toma pedidos, cobra, avisa a cocina y te
            muestra todo en un panel — para restaurantes, pizzerías, hamburgueserías y negocios de comida similares.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a
              href={DEMO_MAILTO}
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
              Solicita una demo
            </a>
            <a
              href="#servicios"
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
              Ver todo lo que incluye
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
                  Tu negocio
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

      {/* Servicios */}
      <section id="servicios" style={{ background: "#fffbec", padding: "56px 32px" }}>
        <h2 style={{ textAlign: "center", fontSize: "1.75rem", fontWeight: 800, margin: "0 0 8px" }}>
          Todo lo que necesita tu negocio, en un solo lugar
        </h2>
        <p style={{ textAlign: "center", color: "#4d4c52", margin: "0 0 40px" }}>
          {PRODUCT_NAME} no es solo un chatbot — es la plataforma completa detrás del pedido.
        </p>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column", gap: 40 }}>
          {FEATURE_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 style={{ fontSize: "1.0625rem", fontWeight: 800, color: "#2a8f17", margin: "0 0 16px" }}>
                {group.title}
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
                {group.items.map((item) => (
                  <div
                    key={item.title}
                    style={{
                      background: "#ffffff",
                      borderRadius: 14,
                      padding: 20,
                      border: "1px solid rgba(0,0,0,0.06)",
                    }}
                  >
                    <h4 style={{ fontSize: 14.5, fontWeight: 700, margin: "0 0 6px" }}>{item.title}</h4>
                    <p style={{ color: "#4d4c52", fontSize: 13.5, margin: 0, lineHeight: 1.5 }}>{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Como funciona */}
      <section style={{ padding: "56px 32px" }}>
        <h2 style={{ textAlign: "center", fontSize: "1.75rem", fontWeight: 800, margin: "0 0 40px" }}>
          Empezar toma minutos, no semanas
        </h2>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", justifyContent: "center", maxWidth: 900, margin: "0 auto" }}>
          {STEPS.map((s) => (
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

      {/* CTA final */}
      <section
        style={{
          background: "linear-gradient(135deg, #3fbf25, #2a8f17)",
          color: "#fff",
          padding: "56px 32px",
          textAlign: "center",
        }}
      >
        <h2 style={{ fontSize: "1.75rem", fontWeight: 800, margin: "0 0 12px" }}>
          Lleva {PRODUCT_NAME} a tu negocio
        </h2>
        <p style={{ opacity: 0.9, margin: "0 0 24px" }}>Te lo configuramos y lo dejamos funcionando en minutos.</p>
        <a
          href={DEMO_MAILTO}
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
          Solicita una demo
        </a>
      </section>

      <footer style={{ padding: "24px 32px", textAlign: "center", color: "#4d4c52", fontSize: 12.5 }}>
        {PRODUCT_NAME} · Creado por{" "}
        <span style={{ color: "#31a71b", fontWeight: 700 }}>KenzyGroup S.A.S</span>
      </footer>
    </div>
  );
}
