# Configuración de Supabase (PostgreSQL) — Fase 3

Este documento explica cómo conectar **Football AI Predictor** a una base de datos PostgreSQL gestionada en **Supabase** de forma segura.

---

## 1. Crear proyecto en Supabase

1. Accede a [https://supabase.com](https://supabase.com) e inicia sesión.
2. Pulsa **New Project**, elige tu organización, asigna un nombre (ej. `football-ai-predictor`), genera una contraseña segura para la base de datos y selecciona la región más cercana.
3. Espera ~1–2 minutos a que Supabase aprovisione la instancia PostgreSQL.

---

## 2. Obtener las credenciales necesarias

Dentro de tu proyecto en Supabase:

1. **API Settings** (`Project Settings -> API`):
   - Copia **Project URL** -> `SUPABASE_URL`
   - Copia **anon public key** -> `SUPABASE_ANON_KEY`
   - Copia **service_role secret key** (opcional para tareas administrativas) -> `SUPABASE_SERVICE_ROLE_KEY`
2. **Database Connection String** (`Connect` / `Project Settings -> Database -> Connection string -> URI`):
   - Selecciona el modo **Transaction Pooler** o **Session Pooler** (recomendado para Node.js/serverless, puerto `6543` o `5432`) o conexión directa IPv4.
   - Copia la URI y reemplaza `[YOUR-PASSWORD]` por tu contraseña real -> `DATABASE_URL`

---

## 3. Configurar variables de entorno (Secrets)

En **AI Studio -> Secrets** (o en tu `.env` local no versionado), define:

```env
SUPABASE_URL="https://TU_PROYECTO.supabase.co"
SUPABASE_ANON_KEY="eyJ..."
DATABASE_URL="postgresql://postgres.TU_PROYECTO:TU_PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres"
DATABASE_SSL="true"
```

> **Seguridad**: Nunca subas `.env` al repositorio ni uses el prefijo `VITE_` en `DATABASE_URL` o `SUPABASE_SERVICE_ROLE_KEY`. El frontend únicamente consume rutas `/api/*` del servidor Express.

---

## 4. Ejecutar migraciones versionadas

Tienes dos opciones equivalentes:

### Opción A: Mediante CLI en el proyecto (recomendada)
```bash
npm run db:migrate
```
Esto ejecutará en orden los archivos SQL en `supabase/migrations/` (`0001_initial_schema.sql`, `0002_seed_master_leagues.sql`) dentro de una transacción segura, registrando cada versión en `schema_migrations`.

### Opción B: Desde Supabase SQL Editor
Si prefieres ejecutarlas manualmente desde el panel web de Supabase:
1. Abre **SQL Editor -> New query**.
2. Pega y ejecuta el contenido de `supabase/migrations/0001_initial_schema.sql`.
3. Pega y ejecuta el contenido de `supabase/migrations/0002_seed_master_leagues.sql`.

---

## 5. Verificar conexión

1. Inicia o reinicia el servidor (`npm run dev`).
2. Abre la aplicación y verifica en la barra superior o en **Configuración** el estado **Base de datos conectada (PostgreSQL)**.
3. También puedes consultar `GET /api/health/db`.
