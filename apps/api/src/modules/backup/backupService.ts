import { spawn } from "node:child_process";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // revisa una vez por hora si ya toca respaldar
let lastBackupRunDay: string | null = null;

function runPgDump(outputFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // pg_dump no acepta el query param "schema" en la URI (a diferencia de Prisma) — se pasa
    // aparte con --schema y se le quita de la URL para que no lo rechace como invalido.
    const url = new URL(env.DATABASE_URL);
    const schema = url.searchParams.get("schema");
    url.searchParams.delete("schema");

    // --format=custom + gzip a nivel de pg_dump (-Z) da un dump comprimido restaurable con
    // pg_restore. DATABASE_URL trae usuario/password, no hace falta pasarlos aparte.
    const args = ["--format=custom", "--compress=9", `--file=${outputFile}`];
    if (schema) args.push(`--schema=${schema}`);
    args.push(url.toString());

    const child = spawn("pg_dump", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump salio con codigo ${code}: ${stderr}`));
    });
  });
}

async function rotateOldBackups(dir: string, retentionDays: number): Promise<void> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const files = await readdir(dir);

  for (const file of files) {
    if (!file.startsWith("backup-") || !file.endsWith(".dump")) continue;
    const filePath = path.join(dir, file);
    const stats = await stat(filePath);
    if (stats.mtimeMs < cutoff) {
      await unlink(filePath);
      logger.info({ file }, "Backup expirado eliminado");
    }
  }
}

export async function runBackupIfDue(): Promise<void> {
  if (!env.BACKUP_ENABLED) return;

  const todayKey = new Intl.DateTimeFormat("en-CA").format(new Date());
  if (lastBackupRunDay === todayKey) return;

  const dir = path.resolve(env.BACKUP_DIR);
  await mkdir(dir, { recursive: true });

  const outputFile = path.join(dir, `backup-${todayKey}.dump`);

  try {
    await runPgDump(outputFile);
    lastBackupRunDay = todayKey;
    logger.info({ outputFile }, "Backup diario de la base de datos creado");
    await rotateOldBackups(dir, env.BACKUP_RETENTION_DAYS);
  } catch (error) {
    // No marcamos lastBackupRunDay como hecho si fallo, asi se reintenta en el siguiente
    // chequeo (cada hora) en vez de esperar hasta manana. pg_dump no instalado (ej: en la
    // maquina de desarrollo sin postgresql-client) es el caso mas comun de fallo aqui.
    logger.error({ err: error }, "Fallo el backup automatico de la base de datos");
  }
}

/** Revisa cada hora si ya toca el backup diario (uno por dia, con retencion configurable). */
export function startBackupScheduler(): void {
  if (!env.BACKUP_ENABLED) {
    logger.info("Backup automatico deshabilitado (BACKUP_ENABLED=false)");
    return;
  }
  runBackupIfDue();
  setInterval(runBackupIfDue, CHECK_INTERVAL_MS);
  logger.info({ dir: env.BACKUP_DIR, retentionDays: env.BACKUP_RETENTION_DAYS }, "Scheduler de backup diario iniciado");
}
