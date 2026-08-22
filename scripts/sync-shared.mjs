// Workaround: en discos exFAT, pnpm no puede symlinkear (ni copiar via "injected")
// paquetes de workspace de forma confiable. Este script copia el paquete ya compilado
// packages/shared directo a node_modules/@pollos/shared despues de cada build,
// para que apps/api y apps/admin lo puedan resolver como si fuera una dependencia normal.
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const source = path.join(root, "packages", "shared");
const target = path.join(root, "node_modules", "@pollos", "shared");

if (!existsSync(path.join(source, "dist"))) {
  console.error("packages/shared/dist no existe. Corre el build de @pollos/shared primero.");
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(path.join(source, "dist"), path.join(target, "dist"), { recursive: true });
cpSync(path.join(source, "package.json"), path.join(target, "package.json"));

console.log(`Sincronizado @pollos/shared -> ${target}`);
