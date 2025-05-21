// upload/src/scripts/forceSchemaRebuild.ts
import { DatabaseManager } from '../db/DatabaseManager.js';
import { ConfigurationManager } from '../config/ConfigurationManager.js';
import { logger } from '../utils/logger.js';

async function main() {
  logger.info('[forceSchemaRebuildScript] Attempting to force schema rebuild...');

  // Initialize ConfigurationManager to ensure DB connection details are loaded from .env if applicable
  try {
    ConfigurationManager.getInstance();
    logger.info('[forceSchemaRebuildScript] ConfigurationManager initialized.');
  } catch (configError) {
    logger.error('[forceSchemaRebuildScript] Failed to initialize ConfigurationManager:', configError);
    process.exit(1);
  }

  if (process.env.FORCE_SCHEMA_RUN !== 'true') {
    logger.error(
      '[forceSchemaRebuildScript] ERROR: This script is intended to be run with FORCE_SCHEMA_RUN=true in the environment.'
    );
    logger.error(
      '[forceSchemaRebuildScript] It will now proceed, but the DatabaseManager might not force a schema run if the env var is not set correctly by the calling script (e.g., build.sh).'
    );
    // process.exit(1); // You might choose to exit if the env var isn't strictly set by the caller
  }

  try {
    // The act of getting the instance will trigger initialization,
    // which in turn checks FORCE_SCHEMA_RUN
    logger.info('[forceSchemaRebuildScript] Requesting DatabaseManager instance to trigger initialization...');
    const dbManager = await DatabaseManager.getInstance();
    logger.info('[forceSchemaRebuildScript] DatabaseManager.getInstance() completed.');

    // Check if initialization was actually successful (it might not throw but still fail internally)
    // The internal logic of getInstance should throw if init fails.
    // Here we just confirm it looks okay.
    if (dbManager.getPool()) {
      // Simple check to see if we have a pool
      logger.info('[forceSchemaRebuildScript] Database pool seems available.');
    } else {
      logger.error('[forceSchemaRebuildScript] Database pool is not available after getInstance().');
      throw new Error('Database pool unavailable after schema rebuild attempt.');
    }

    logger.info(
      '[forceSchemaRebuildScript] Database schema rebuild process should have been triggered if FORCE_SCHEMA_RUN was true.'
    );

    // Explicitly close the pool as this script is short-lived
    await dbManager.closeDb();
    logger.info('[forceSchemaRebuildScript] Database pool closed. Script finished.');
    process.exit(0);
  } catch (error) {
    logger.error('[forceSchemaRebuildScript] Failed to force schema rebuild:', error);
    process.exit(1);
  }
}

main();
