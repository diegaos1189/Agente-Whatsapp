import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { startDailyArchiveScheduler } from "./modules/scheduler/dailyArchive.js";
import { startBackupScheduler } from "./modules/backup/backupService.js";
import { ensureBootstrapAdmin } from "./modules/adminUsers/adminUserService.js";
import { startCartRecoveryScheduler } from "./modules/conversation/cartRecoveryService.js";

const app = buildApp();

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then(async (address) => {
    logger.info(`API escuchando en ${address}`);
    await ensureBootstrapAdmin(env.ADMIN_BOOTSTRAP_USERNAME, env.ADMIN_BOOTSTRAP_PASSWORD);
    startDailyArchiveScheduler();
    startBackupScheduler();
    startCartRecoveryScheduler();
  })
  .catch((error) => {
    logger.error({ err: error }, "No se pudo iniciar el servidor");
    process.exit(1);
  });
