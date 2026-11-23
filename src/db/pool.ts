import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

declare global {
  var _footballPgPool: Pool | undefined;
}

function cleanEnvValue(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function isDatabaseConfigured(): boolean {
  const url = cleanEnvValue(process.env.DATABASE_URL);
  return Boolean(url && url.length > 0 && !url.includes('TU_PASSWORD'));
}

export function isSupabaseClientConfigured(): boolean {
  return Boolean(
    cleanEnvValue(process.env.SUPABASE_URL) && cleanEnvValue(process.env.SUPABASE_ANON_KEY)
  );
}

function buildPoolConfig(): {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionString?: string;
  ssl: boolean | { rejectUnauthorized: boolean };
  targetHostLabel: string;
} {
  const rawUrl = cleanEnvValue(process.env.DATABASE_URL);
  const useSsl = cleanEnvValue(process.env.DATABASE_SSL) !== 'false';
  const sslConfig = useSsl ? { rejectUnauthorized: false } : false;

  try {
    const parsed = new URL(rawUrl);
    const port = parsed.port ? Number(parsed.port) : 5432;
    const safeDecode = (val: string) => {
      try {
        return decodeURIComponent(val);
      } catch {
        return val;
      }
    };
    return {
      host: parsed.hostname,
      port,
      user: safeDecode(parsed.username),
      password: safeDecode(parsed.password),
      database: parsed.pathname.replace(/^\//, '') || 'postgres',
      ssl: sslConfig,
      targetHostLabel: `${parsed.hostname}:${port}`,
    };
  } catch {
    return {
      connectionString: rawUrl,
      ssl: sslConfig,
      targetHostLabel: 'DATABASE_URL',
    };
  }
}

export function getPool(): Pool | null {
  if (!isDatabaseConfigured()) {
    return null;
  }

  if (!global._footballPgPool) {
    const cfg = buildPoolConfig();
    global._footballPgPool = new Pool({
      ...(cfg.connectionString
        ? { connectionString: cfg.connectionString }
        : {
            host: cfg.host,
            port: cfg.port,
            user: cfg.user,
            password: cfg.password,
            database: cfg.database,
          }),
      ssl: cfg.ssl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    global._footballPgPool.on('error', (err) => {
      console.error('[PostgreSQL Pool Error]:', err.message);
    });
  }

  return global._footballPgPool;
}

export async function checkDatabaseConnection(): Promise<{
  configured: boolean;
  supabaseConfigured: boolean;
  connected: boolean;
  schemaReady: boolean;
  error: string | null;
}> {
  const configured = isDatabaseConfigured();
  const supabaseConfigured = isSupabaseClientConfigured();

  if (!configured) {
    return {
      configured: false,
      supabaseConfigured,
      connected: false,
      schemaReady: false,
      error: 'Variable DATABASE_URL no configurada en el servidor.',
    };
  }

  const cfg = buildPoolConfig();
  const pool = getPool();
  if (!pool) {
    return {
      configured: false,
      supabaseConfigured,
      connected: false,
      schemaReady: false,
      error: 'No se pudo inicializar el pool de PostgreSQL.',
    };
  }

  try {
    await pool.query('SELECT 1 AS ok');
    const tableCheck = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'leagues'
      ) AS exists`
    );
    const schemaReady = Boolean(tableCheck.rows[0]?.exists);
    return {
      configured: true,
      supabaseConfigured,
      connected: true,
      schemaReady,
      error: schemaReady
        ? null
        : 'Conexión exitosa a PostgreSQL, pero las migraciones aún no se han ejecutado (tabla leagues no encontrada).',
    };
  } catch (err) {
    const pgErr = err as Error & { code?: string; address?: string };
    const code = pgErr.code ?? 'UNKNOWN';
    console.error('[DB Health Check Error]:', code, pgErr.message);

    let friendlyError = `Error de conexión (${code}) al intentar conectar con ${cfg.targetHostLabel}.`;
    if (
      (code === 'ENETUNREACH' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') &&
      cfg.host?.startsWith('db.')
    ) {
      friendlyError = `El host directo ${cfg.targetHostLabel} de Supabase usa IPv6 o no es alcanzable desde este entorno. En Supabase, abre "Connect -> Session Pooler" (IPv4) y usa la URI con pooler.supabase.com.`;
    } else if (code === '28P01' || code === '28000') {
      friendlyError = `Autenticación rechazada (${code}) en ${cfg.targetHostLabel}. Verifica usuario y contraseña en DATABASE_URL.`;
    } else if (code === 'XX000' || pgErr.message.includes('Tenant or user not found')) {
      friendlyError = `Usuario o proyecto no reconocido por el pooler (${cfg.targetHostLabel}). Verifica el usuario postgres.<PROJECT_REF> en la URI de Supabase Pooler.`;
    }

    return {
      configured: true,
      supabaseConfigured,
      connected: false,
      schemaReady: false,
      error: friendlyError,
    };
  }
}
