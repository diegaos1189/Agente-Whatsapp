/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // El panel maneja datos del negocio y sesiones: nadie deberia poder embeberlo
          // en un iframe (clickjacking) ni adivinar tipos de contenido (MIME sniffing).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  webpack: (config) => {
    // En algunos entornos Windows no-C:/ el resolvedor/snapshot de webpack intenta
    // hacer readlink sobre archivos normales dentro de next/dist y falla con EISDIR.
    // Desactivar resolucion de symlinks y cache persistente evita ese camino.
    config.resolve = config.resolve ?? {};
    config.resolve.symlinks = false;
    config.cache = false;
    return config;
  },
};

export default nextConfig;
