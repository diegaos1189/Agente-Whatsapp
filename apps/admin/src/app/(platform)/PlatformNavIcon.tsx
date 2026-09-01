// Iconos propios del area de plataforma. No reusa (dashboard)/NavIcon.tsx a proposito: esa
// lista es la del panel de un solo restaurante y esta seccion no debe agregarle entradas.
const ICONS = {
  restaurants: (
    <>
      <path d="M4 9h16l-.8 10a2 2 0 0 1-2 1.8H6.8a2 2 0 0 1-2-1.8L4 9Z" />
      <path d="M3.5 9 5 4.2A1.6 1.6 0 0 1 6.5 3h11A1.6 1.6 0 0 1 19 4.2L20.5 9" />
      <path d="M9.5 3v6M14.5 3v6" />
    </>
  ),
  leads: (
    <>
      <path d="M4 4h16v13H8l-4 4V4Z" />
      <path d="M8 9h8M8 12.5h5" />
    </>
  ),
} as const;

export type PlatformNavIconName = keyof typeof ICONS;

export function PlatformNavIcon({ name }: { name: PlatformNavIconName }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}
