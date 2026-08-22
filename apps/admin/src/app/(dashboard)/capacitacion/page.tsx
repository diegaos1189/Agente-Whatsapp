interface Guide {
  title: string;
  intro: string;
  steps: string[];
}

const GUIDES: Guide[] = [
  {
    title: "Conversaciones",
    intro: "Aquí ves todos los chats de WhatsApp que el agente está llevando con los clientes.",
    steps: [
      "Entra a Conversaciones en el menú lateral. Verás una tarjeta por cada cliente, con su número y nombre (si lo dio).",
      "Busca por número o nombre con la barra de búsqueda arriba.",
      "Haz clic en Ver para abrir el chat completo y ver todos los mensajes, imágenes y audios enviados.",
      "Si un cliente necesita atención humana, la conversación se marca en rojo (\"handoff\"). Ahí puedes responder directamente escribiendo abajo del chat.",
      "En el panel de la derecha vas a ver el pedido que el agente ya armó con el cliente (si hay uno en curso). Puedes editarlo: cambiar cantidades, quitar productos, agregar más.",
      "Botón Guardar: guarda tus cambios al pedido sin avisarle nada al cliente todavía.",
      "Botón Confirmar con el cliente (IA): le manda un mensaje al cliente resumiendo el pedido y pidiéndole que confirme con un \"sí\".",
      "Si el cliente mandó una foto (ej: comprobante de pago), haz clic en la imagen para verla en grande.",
      "Cuando termines de atender manualmente, usa Resolver handoff para devolverle el control al agente automático.",
    ],
  },
  {
    title: "Pedidos",
    intro: "Aquí se administran todos los pedidos ya confirmados, vigentes y entregados.",
    steps: [
      "Entra a Pedidos. Verás tarjetas con el código del pedido, cliente, total, tipo de entrega, forma de pago y tiempo transcurrido.",
      "Usa el selector de estado en cada tarjeta para avanzar el pedido: Recibido → Listo → En reparto → Entregado.",
      "Si el pedido es por transferencia, aparece \"Esperando pago\" — verifica que la plata haya llegado y haz clic en Pago confirmado.",
      "Si necesitas corregir lo que pidió el cliente (agregar, quitar o cambiar cantidades), usa el botón Corregir. Al guardar, se le avisa automáticamente al cliente por WhatsApp.",
      "Si un pedido aparece marcado en rojo con una alerta, es porque el cliente agregó más cosas mientras el pedido seguía sin despachar — revísalo y haz clic en Ya revisé.",
      "Busca cualquier pedido por código, cliente o teléfono con la barra de búsqueda.",
    ],
  },
  {
    title: "Cocina",
    intro: "Pantalla pensada para la persona que está preparando los pedidos.",
    steps: [
      "Entra a Cocina. Aparecen solo los pedidos que están en preparación, del más antiguo al más nuevo.",
      "Cada tarjeta muestra los productos exactos a preparar, con notas si el cliente dejó alguna instrucción especial.",
      "Si un pedido se está demorando más de lo normal, la tarjeta se pone en rojo para que se atienda primero.",
      "Botón Imprimir comanda: imprime solo esa tarjeta (no toda la pantalla) en una impresora conectada al computador.",
      "Botón Listo: marca el pedido como preparado y pasa automáticamente a Pedidos con estado \"Listo\".",
    ],
  },
  {
    title: "Productos",
    intro: "Aquí se administra el catálogo completo: lo que el agente conoce y le puede vender al cliente.",
    steps: [
      "Primero crea las categorías (ej: Combos, Bebidas, Acompañantes) con el formulario de la izquierda.",
      "Haz clic en + Nuevo producto para abrir la ventana de creación: nombre, categoría, precio, y datos opcionales (cantidad de piezas, palabras clave, descripción).",
      "Si la categoría se llama \"Combos\" (o contiene esa palabra), la ventana te deja armar qué productos incluye el combo.",
      "Usa las pestañas (Todos, y cada categoría) para filtrar la tabla de productos.",
      "Botón Editar en cualquier fila: abre la misma ventana con los datos ya cargados para modificarlos.",
      "Botón Desactivar: el producto deja de ofrecerse a los clientes sin borrarlo (útil si se acabó por el momento). Activar lo vuelve a poner disponible.",
      "\"Mostrar en el menú del bot\": si se apaga, el producto sigue siendo pedible por nombre pero no aparece en la lista general (útil para ingredientes que solo van dentro de un combo).",
      "\"Variante por defecto de su categoría\": si el cliente pide algo ambiguo (ej: \"un pollo\" sin especificar), el agente ofrece la marcada como default.",
      "Panel Orden del menú (derecha): usa las flechas ▲▼ para cambiar el orden en que se muestran las categorías y productos cuando el bot manda el menú por WhatsApp.",
    ],
  },
  {
    title: "Facturación",
    intro: "Registro de ventas — se genera solo, por cada pedido, sin que tengas que digitar nada.",
    steps: [
      "Entra a Facturación para ver la lista de todas las ventas: número, cliente, fecha, tipo de entrega y estado de pago.",
      "Usa Ver pedido para saltar directamente a esa tarjeta en la pantalla de Pedidos.",
      "Busca por número de factura, cliente o teléfono con la barra de búsqueda.",
    ],
  },
  {
    title: "Promociones",
    intro: "Ofertas y descuentos que el agente puede mencionar o aplicar automáticamente.",
    steps: [
      "Crea una promoción con título, descripción, y si quieres, un descuento (porcentaje o monto fijo) sobre un producto específico.",
      "Actívala o desactívala según la necesites — solo las activas se le muestran al cliente.",
      "Si un cliente pregunta \"¿qué me recomienda?\", el agente prioriza mencionar las promociones activas.",
    ],
  },
  {
    title: "Preguntas frecuentes (FAQ)",
    intro: "Respuestas ya aprobadas por ti para que el agente las use tal cual, sin inventar.",
    steps: [
      "Agrega la pregunta como la escribiría un cliente real y la respuesta exacta que quieres que se envíe.",
      "El agente busca coincidencias por palabras clave — no necesita ser exacta la redacción del cliente.",
      "Desactiva una FAQ si ya no aplica, sin perder el historial.",
    ],
  },
  {
    title: "Configuración",
    intro: "Datos generales del negocio que usa el agente en cada conversación.",
    steps: [
      "Nombre del negocio, horario, moneda y tarifa de domicilio.",
      "Mensaje de bienvenida: lo que el bot dice apenas un cliente nuevo escribe (o vuelve después de mucho tiempo). Si lo dejas vacío, se usa un saludo genérico automático.",
      "Logo: subilo aquí y se muestra arriba del menú lateral en todo el panel.",
      "Solo el usuario Administrador puede entrar a esta sección.",
    ],
  },
  {
    title: "Usuarios",
    intro: "Control de quién puede entrar al panel y qué secciones puede ver.",
    steps: [
      "Crea un usuario nuevo con rol Staff para tu equipo (cocina, domicilios, atención al cliente).",
      "Marca solo los permisos que esa persona necesita (ej: alguien de cocina solo necesita el permiso Cocina).",
      "El rol Administrador ve y edita todo, incluyendo Configuración y Usuarios.",
    ],
  },
];

export default function CapacitacionPage() {
  return (
    <div>
      <h2 style={{ margin: 0 }}>Capacitación</h2>
      <p className="muted" style={{ marginTop: 4, marginBottom: 20 }}>
        Guías paso a paso de cómo funciona cada sección del panel.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {GUIDES.map((g) => (
          <details key={g.title} className="settings-section" style={{ padding: "16px 20px" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "1rem" }}>{g.title}</summary>
            <p className="muted" style={{ marginTop: 10 }}>{g.intro}</p>
            <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
              {g.steps.map((step, i) => (
                <li key={i} style={{ fontSize: "0.875rem" }}>
                  {step}
                </li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    </div>
  );
}
