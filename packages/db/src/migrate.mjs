import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultMigrationsDir = path.join(packageRoot, "migrations");

export async function migrationFiles(migrationsDir = defaultMigrationsDir) {
  const entries = await readdir(migrationsDir);
  return entries.filter((entry) => entry.endsWith(".sql")).sort();
}

export async function migrate(databaseUrl, options = {}) {
  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = [];

    for (const file of await migrationFiles(migrationsDir)) {
      const exists = await client.query("select 1 from schema_migrations where filename = $1", [file]);
      if (exists.rowCount > 0) {
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
        applied.push(file);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    return { applied };
  } finally {
    await client.end();
  }
}

export async function resetDatabase(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      do $$
      begin
        if exists (select 1 from pg_roles where rolname = 'hookwire_app') then
          reassign owned by hookwire_app to postgres;
          drop owned by hookwire_app;
          drop role hookwire_app;
        end if;
      end
      $$;

      drop schema if exists hookwire cascade;
      drop schema if exists public cascade;
      create schema public authorization postgres;
      grant all on schema public to postgres;
      grant usage on schema public to public;
    `);
  } finally {
    await client.end();
  }
}

async function ensureMigrationsTable(client) {
  await client.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

/* c8 ignore start */
async function main() {
  const command = process.argv[2] ?? "migrate";
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  if (command === "migrate") {
    const result = await migrate(databaseUrl);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "reset") {
    await resetDatabase(databaseUrl);
    console.log(JSON.stringify({ reset: true }, null, 2));
    return;
  }

  throw new Error(`Unknown db command: ${command}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
