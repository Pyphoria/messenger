import { FastifyInstance } from "fastify";
import { pool } from "../db/index.js";
import { hashPassword, verifyPassword } from "../utils/hash.js";

export async function authRoutes(fastify: FastifyInstance) {
  // Register
  fastify.post("/api/v1/register", async (request, reply) => {
    const body = request.body as any;
    const { username, email, password } = body;
    if (!username || !password) {
      return reply.status(400).send({ error: "username and password required" });
    }
    try {
      const password_hash = await hashPassword(password);
      const res = await pool.query(
        `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at`,
        [username, email || null, password_hash]
      );
      const user = res.rows[0];
      return { ok: true, user };
    } catch (err: any) {
      if (err.code === "23505") { // unique_violation
        return reply.status(409).send({ error: "username or email already exists" });
      }
      request.log.error(err);
      return reply.status(500).send({ error: "internal error" });
    }
  });

  // Login -> returns JWT
  fastify.post("/api/v1/login", async (request, reply) => {
    const { username, password } = request.body as any;
    if (!username || !password) return reply.status(400).send({ error: "username & password required" });

    const res = await pool.query(`SELECT id, username, password_hash FROM users WHERE username = $1`, [username]);
    if (res.rowCount === 0) return reply.status(401).send({ error: "invalid credentials" });

    const row = res.rows[0];
    const ok = await verifyPassword(row.password_hash, password);
    if (!ok) return reply.status(401).send({ error: "invalid credentials" });

    const token = fastify.jwt.sign({ userId: row.id, username: row.username });

    return { ok: true, token };
  });
}