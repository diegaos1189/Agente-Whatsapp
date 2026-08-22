"use client";

export function PrintTicketButton({ orderId }: { orderId: string }) {
  function handlePrint() {
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-kitchen-ticket]"));
    const target = document.querySelector<HTMLElement>(`[data-kitchen-ticket="${orderId}"]`);
    if (!target) return;
    cards.forEach((c) => c.classList.add("kitchen-ticket-hide"));
    target.classList.remove("kitchen-ticket-hide");
    const restore = () => {
      cards.forEach((c) => c.classList.remove("kitchen-ticket-hide"));
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }

  return (
    <button type="button" className="secondary" onClick={handlePrint}>
      Imprimir comanda
    </button>
  );
}
