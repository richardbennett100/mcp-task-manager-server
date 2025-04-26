import { logger } from '../utils/logger.js'; // Assuming logger is needed for potential warnings

// Define the structure for all configurations managed
interface ManagedConfigs {
  // Add other service config types here:
  // yourService: Required<YourServiceConfig>;

  // PostgreSQL connection details
  pgHost: string;
  pgPort: number;
  pgUser: string;
  pgPassword?: string; // Optional, might be handled differently (e.g., env var only)
  pgDatabase: string;
  // Optionally add SSL config, connection timeout, etc.
  // pgSsl: boolean | object;
  // pgConnectionTimeoutMillis: number;
}

/**
 * Centralized configuration management for all services.
 * Implements singleton pattern to ensure consistent configuration.
 */
export class ConfigurationManager {
  private static instance: ConfigurationManager | null = null;
  private static instanceLock = false;

  // Make config public temporarily for easier access in DatabaseManager
  // Or provide individual getters for each PG setting
  public config: ManagedConfigs;

  private constructor() {
    // Initialize with default configurations for PostgreSQL
    this.config = {
      pgHost: 'localhost',
      pgPort: 5432,
      pgUser: 'taskmanager_user', // Choose a suitable default user
      pgPassword: undefined, // Avoid default passwords in code
      pgDatabase: 'taskmanager_db', // Choose a suitable default DB name
      // pgSsl: false,
      // pgConnectionTimeoutMillis: 5000,
    };

    // Load overrides from environment variables
    this.loadEnvironmentOverrides();
  }

  /**
   * Get the singleton instance of ConfigurationManager.
   */
  public static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      if (!ConfigurationManager.instanceLock) {
        ConfigurationManager.instanceLock = true; // Lock
        try {
          ConfigurationManager.instance = new ConfigurationManager();
        } finally {
          ConfigurationManager.instanceLock = false; // Unlock
        }
      } else {
        while (ConfigurationManager.instanceLock) {
          //not empty
        }
        if (!ConfigurationManager.instance) {
          return ConfigurationManager.getInstance();
        }
      }
    }
    return ConfigurationManager.instance;
  }

  // --- Getters for specific configurations ---

  // Provide individual getters for PG settings if config remains private
  public getPgHost(): string {
    return this.config.pgHost;
  }
  public getPgPort(): number {
    return this.config.pgPort;
  }
  public getPgUser(): string {
    return this.config.pgUser;
  }
  public getPgPassword(): string | undefined {
    return this.config.pgPassword;
  }
  public getPgDatabase(): string {
    return this.config.pgDatabase;
  }
  // public getPgSsl(): boolean | object { return this.config.pgSsl; }
  // public getPgConnectionTimeoutMillis(): number { return this.config.pgConnectionTimeoutMillis; }

  // --- Updaters (if runtime updates are needed - less common for DB config) ---
  // Add updaters if necessary

  /**
   * Load configuration overrides from environment variables.
   */
  private loadEnvironmentOverrides(): void {
    logger.info('Loading environment variable overrides for configuration...');

    if (process.env.PGHOST) {
      this.config.pgHost = process.env.PGHOST;
      logger.info(`Overriding pgHost from env: ${this.config.pgHost}`);
    }
    if (process.env.PGPORT) {
      const port = parseInt(process.env.PGPORT, 10);
      if (!isNaN(port)) {
        this.config.pgPort = port;
        logger.info(`Overriding pgPort from env: ${this.config.pgPort}`);
      } else {
        logger.warn(
          `Invalid PGPORT environment variable: ${process.env.PGPORT}. Using default ${this.config.pgPort}.`
        );
      }
    }
    if (process.env.PGUSER) {
      this.config.pgUser = process.env.PGUSER;
      logger.info(`Overriding pgUser from env: ${this.config.pgUser}`);
    }
    // Recommended: Load password *only* from env var, don't keep default
    if (process.env.PGPASSWORD) {
      this.config.pgPassword = process.env.PGPASSWORD;
      logger.info('Overriding pgPassword from env.'); // Don't log the password itself
    }
    if (process.env.PGDATABASE) {
      this.config.pgDatabase = process.env.PGDATABASE;
      logger.info(`Overriding pgDatabase from env: ${this.config.pgDatabase}`);
    }

    // Example for optional SSL (can be complex, might need 'true', 'false', or JSON object)
    // if (process.env.PGSSL) {
    //     if (process.env.PGSSL.toLowerCase() === 'true') {
    //         this.config.pgSsl = true;
    //     } else if (process.env.PGSSL.toLowerCase() === 'false') {
    //         this.config.pgSsl = false;
    //     } else {
    //         try {
    //             this.config.pgSsl = JSON.parse(process.env.PGSSL); // For SSL config objects
    //         } catch (e) {
    //             logger.warn(`Could not parse PGSSL env var as JSON: ${e}. Using default ${this.config.pgSsl}`);
    //         }
    //     }
    //     logger.info(`Overriding pgSsl from env: ${JSON.stringify(this.config.pgSsl)}`);
    // }

    // Example for timeout
    // if (process.env.PGCONNECTION_TIMEOUT_MS) {
    //     const timeout = parseInt(process.env.PGCONNECTION_TIMEOUT_MS, 10);
    //     if (!isNaN(timeout)) {
    //         this.config.pgConnectionTimeoutMillis = timeout;
    //         logger.info(`Overriding pgConnectionTimeoutMillis from env: ${this.config.pgConnectionTimeoutMillis}`);
    //     } else {
    //         logger.warn(`Invalid PGCONNECTION_TIMEOUT_MS env var: ${process.env.PGCONNECTION_TIMEOUT_MS}. Using default ${this.config.pgConnectionTimeoutMillis}.`);
    //     }
    // }

    // Add logic for other services based on their environment variables
  }
}
