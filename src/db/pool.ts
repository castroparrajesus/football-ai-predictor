import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

declare global {
  var _footballPgPool: Pool | undefined;
}

export function isDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return Boolean(url && url.length > 0 && !url.includes('TU_PASSWORD'));
}

export function isSupabaseClientConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_ANON_KEY?.trim()
  );
}

export function getPool(): Pool | null {
  if (!isDatabaseConfigured()) {
    return null;
  }

  if (!global._footballPgPool) {
    const useSsl = process.env.DATABASE_SSL !== 'false';
    global._footballPgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
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
        : 'Conexión exitosa, pero las migraciones aún no se han ejecutado (tabla leagues no encontrada).',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido de conexión';
    console.error('[DB Health Check Error]:', message);
    return {
      configured: true,
      supabaseConfigured,
      connected: false,
      schemaReady: false,
      error: 'No se pudo establecer conexión con PostgreSQL. Verifica DATABASE_URL y el acceso de red/SSL.',
    };
  }
}
