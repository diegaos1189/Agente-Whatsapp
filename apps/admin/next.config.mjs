/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
