"use client";

import { useEffect, useState } from "react";

const PRODUCT_NAME = "Pedix";

export function LandingNav({ whatsappLink }: { whatsappLink: string }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 12);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`lp-nav ${scrolled ? "lp-nav-scrolled" : ""}`}>
      <span className="lp-logo">{PRODUCT_NAME}</span>
      <nav className="lp-nav-links">
        <a href="#servicios">Servicios</a>
        <a href="#como-funciona">Cómo funciona</a>
      </nav>
      <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-primary lp-btn-sm">
        <span>Escríbenos</span>
      </a>
    </header>
  );
}
