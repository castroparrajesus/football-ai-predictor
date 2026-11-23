import fs from 'fs';
import path from 'path';
import { getPool, isDatabaseConfigured } from './pool.ts';

export async function runMigrations(): Promise<{
  applied: string[];
  alreadyApplied: string[];
}> {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL no está configurada. Configura Supabase antes de migrar.');
  }

  const pool = getPool();
  if (!pool) {
    throw new Error('Pool de base de datos no disponible.');
  }

  const migrationsDir = path.resolve(process.cwd(), 'supabase', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    throw new Error('Directorio supabase/migrations no encontrado.');
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const existing = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations'
    );
    const appliedSet = new Set(existing.rows.map((r) => r.version));

    for (const file of files) {
      if (appliedSet.has(file)) {
        alreadyApplied.push(file);
        continue;
      }

      const fullPath = path.resolve(migrationsDir, file);
      if (!fullPath.startsWith(migrationsDir + path.sep)) {
        throw new Error(`Ruta de migración inválida: ${file}`);
      }

      const sql = fs.readFileSync(fullPath, 'utf-8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
          [file]
        );
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    return { applied, alreadyApplied };
  } finally {
    client.release();
  }
}

// Ejecución directa vía CLI: npm run db:migrate
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]).endsWith('migrate.ts');

if (isDirectRun) {
  runMigrations()
    .then((res) => {
      console.log('Migraciones aplicadas:', res.applied);
      console.log('Migraciones ya existentes:', res.alreadyApplied);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Error ejecutando migraciones:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
