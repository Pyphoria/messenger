import { FastifyInstance } from "fastify";
import { pool } from "../db/index.js";

export async function deviceRoutes(fastify: FastifyInstance) {
  // Register a device for the authenticated user
  fastify.post("/api/v1/device/register", { preHandler: [fastify.authenticate] }, async (request: any, reply) => {
    /*
      expected body:
      {
        deviceName: string,
        publicKey: "<base64>",
        signedPreKey: "<base64?>",
        prekeys: ["<base64>", ...]
      }
    */
    const body = request.body as any;
    const { deviceName, publicKey, signedPreKey, prekeys } = body;
    const userId = request.user.userId as string;

    if (!publicKey) return reply.status(400).send({ error: "publicKey required" });

    try {
      const res = await pool.query(
        `INSERT INTO devices (user_id, device_name, public_key, signed_prekey, prekeys) VALUES ($1, $2, $3, $4, $5) RETURNING id, device_name, public_key, prekeys, created_at`,
        [userId, deviceName || null, publicKey, signedPreKey || null, prekeys ? JSON.stringify(prekeys) : null]
      );
      const device = res.rows[0];
      return { ok: true, device };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: "internal error" });
    }
  });

  // Simple list devices for user
  fastify.get("/api/v1/devices", { preHandler: [fastify.authenticate] }, async (request: any, reply) => {
    const userId = request.user.userId as string;
    const res = await pool.query(`SELECT id, device_name, public_key, prekeys, last_seen FROM devices WHERE user_id = $1`, [userId]);
    return { ok: true, devices: res.rows };
  });
}