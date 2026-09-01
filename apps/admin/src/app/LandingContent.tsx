import "./landing.css";
import { LandingNav } from "./LandingNav";
import { LeadForm } from "./LeadForm";
import { Reveal } from "./Reveal";

const PRODUCT_NAME = "Pedix";
const WHATSAPP_NUMBER = "573015625504";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
  `Hola, quiero una demo de ${PRODUCT_NAME} para mi negocio`,
)}`;

const ICONS: Record<string, JSX.Element> = {
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
    </svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </svg>
  ),
  bolt: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
    </svg>
  ),
  screen: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  card: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="M2 10h20" />
    </svg>
  ),
  cart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  ),
  target: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z" />
    </svg>
  ),
};

const FEATURE_GROUPS: Array<{
  title: string;
  items: Array<{ title: string; text: string; icon: keyof typeof ICONS }>;
}> = [
  {
    title: "Atención al cliente",
    items: [
      { title: "Agente de WhatsApp con IA", text: "Responde pedidos, dudas del menú y horarios 24/7, con el tono de tu negocio.", icon: "chat" },
      { title: "Recomendaciones y upsell", text: "El agente sugiere combos y acompañantes en el momento justo, sin ser invasivo.", icon: "spark" },
      { title: "CRM de conversaciones", text: "Bandeja tipo WhatsApp con historial completo por cliente y traspaso a un humano cuando hace falta.", icon: "inbox" },
    ],
  },
  {
    title: "Operación",
    items: [
      { title: "Gestión de pedidos en tiempo real", text: "Estados de pago, cocina, despacho y entrega, con alertas cuando un pedido se atasca.", icon: "bolt" },
      { title: "Pantalla de cocina", text: "Vista dedicada para el equipo de cocina: pedidos entrantes y un clic para marcar listo.", icon: "screen" },
      { title: "Catálogo y combos", text: "Categorías, productos, modificadores y precios, editables sin tocar código.", icon: "grid" },
      { title: "Cobros y conciliación", text: "Efectivo, transferencia y tarjeta, con seguimiento de pagos, reembolsos y saldos pendientes.", icon: "card" },
    ],
  },
  {
    title: "Crecimiento",
    items: [
      { title: "Recuperación de carritos", text: "Si un cliente arma un pedido y no lo termina, el agente le escribe para retomarlo.", icon: "cart" },
      { title: "Campañas de reactivación", text: "Detecta clientes que dejaron de pedir y les manda una campaña automática por WhatsApp.", icon: "target" },
      { title: "Métricas y analítica", text: "Ventas, productos más vendidos, horas pico, segmentación de clientes y tiempos de operación.", icon: "chart" },
      { title: "Roles y permisos por equipo", text: "Cocina, ventas y administración, cada quien con acceso solo a lo que necesita.", icon: "shield" },
    ],
  },
];

const STEPS = [
  { step: "1", title: "Conecta tu WhatsApp", text: "Vinculamos el número oficial de tu negocio a la plataforma." },
  { step: "2", title: "Configura tu menú", text: "Cargas categorías, productos y precios desde el panel — sin código." },
  { step: "3", title: "Empieza a vender", text: "El agente atiende, cobra y organiza — tú ves todo desde un solo panel." },
];

const TRUST_ITEMS = ["Configuración en minutos", "Sin permanencia forzada", "Soporte directo por WhatsApp"];

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function LandingContent() {
  return (
    <div className="lp">
      <div className="lp-mesh" />
      <LandingNav whatsappLink={WHATSAPP_LINK} />

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-badge">
            <span className="lp-badge-dot" />
            Agente de WhatsApp + CRM + POS
          </span>
          <h1 className="lp-h1">
            El agente de WhatsApp con IA que{" "}
            <span className="lp-h1-gradient">atiende, vende y organiza</span> tu negocio de comida
          </h1>
          <p className="lp-sub">
            {PRODUCT_NAME} conecta tu WhatsApp con inteligencia artificial: toma pedidos, cobra, avisa a cocina y te
            muestra todo en un panel — para restaurantes, pizzerías, hamburgueserías y negocios de comida similares.
          </p>
          <div className="lp-cta-row">
            <span className="lp-pulse-wrap">
              <a href={WHATSAPP_LINK} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-primary">
                <span>Escríbenos por WhatsApp</span>
              </a>
            </span>
            <a href="#contacto" className="lp-btn lp-btn-ghost">
              Déjanos tus datos
            </a>
          </div>
          <div className="lp-trust">
            {TRUST_ITEMS.map((item) => (
              <span key={item}>
                <CheckIcon />
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* Phone mockup */}
        <div className="lp-phone-stage">
          <div style={{ position: "relative" }}>
            <div className="lp-phone-glow" />
            <div className="lp-phone">
              <div className="lp-phone-screen">
                <div className="lp-phone-bar">
                  <span className="lp-phone-bar-dot" />
                  Tu negocio
                </div>
                <div className="lp-bubble lp-bubble-in-msg" style={{ animationDelay: "0.2s" }}>
                  Hola, quiero un pedido para hoy 🙂
                </div>
                <div className="lp-bubble lp-bubble-out" style={{ animationDelay: "0.9s" }}>
                  ¡Claro! Este es nuestro menú del día, ¿qué te provoca?
                </div>
                <div className="lp-bubble lp-bubble-in-msg" style={{ animationDelay: "1.6s" }}>
                  Deme el combo familiar
                </div>
                <div className="lp-typing" style={{ animationDelay: "2.3s" }}>
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Servicios */}
      <section id="servicios" className="lp-section lp-section-light">
        <Reveal>
          <h2 className="lp-section-title">Todo lo que necesita tu negocio, en un solo lugar</h2>
          <p className="lp-section-sub">{PRODUCT_NAME} no es solo un chatbot — es la plataforma completa detrás del pedido.</p>
        </Reveal>
        {FEATURE_GROUPS.map((group, gi) => (
          <Reveal key={group.title} delay={gi * 80} className="lp-group">
            <h3 className="lp-group-title">{group.title}</h3>
            <div className="lp-card-grid">
              {group.items.map((item) => (
                <div key={item.title} className="lp-card">
                  <div className="lp-card-icon">{ICONS[item.icon]}</div>
                  <h4>{item.title}</h4>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>
          </Reveal>
        ))}
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="lp-section lp-section-light" style={{ paddingTop: 0 }}>
        <Reveal>
          <h2 className="lp-section-title">Empezar toma minutos, no semanas</h2>
        </Reveal>
        <Reveal delay={100}>
          <div className="lp-steps">
            {STEPS.map((s) => (
              <div key={s.step} className="lp-step">
                <div className="lp-step-line" />
                <div className="lp-step-num">{s.step}</div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Contacto */}
      <section id="contacto" className="lp-contact">
        <Reveal className="lp-contact-head">
          <h2>Lleva {PRODUCT_NAME} a tu negocio</h2>
          <p>Te lo configuramos y lo dejamos funcionando en minutos.</p>
          <span className="lp-pulse-wrap">
            <a href={WHATSAPP_LINK} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-light">
              Escríbenos por WhatsApp
            </a>
          </span>
        </Reveal>

        <Reveal delay={120}>
          <div className="lp-contact-card">
            <p className="lp-contact-card-title">O prefieres que te contactemos nosotros:</p>
            <LeadForm />
          </div>
        </Reveal>
      </section>

      <footer className="lp-footer">
        {PRODUCT_NAME} · Creado por <strong>KenzyGroup S.A.S</strong>
      </footer>
    </div>
  );
}
