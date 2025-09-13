import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL not set in env");

export const pool = new Pool({ connectionString });

export async function initMigrations() {
  const sql = await import("fs").then(fs => fs.promises.readFile(
    new URL("./migrations/001_init.sql", import.meta.url),
    "utf8"
  ));
  await pool.query(sql);
}