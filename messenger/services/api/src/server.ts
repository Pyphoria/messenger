import Fastify from "fastify";
import dotenv from "dotenv";
dotenv.config();
import { registerJwt } from "./utils/jwt.js";
import { authRoutes } from "./routes/auth.js";
import { deviceRoutes } from "./routes/device.js";
import { pool, initMigrations } from "./db/index.js";

const server = Fastify({
  logger: true
});

registerJwt(server);

server.get("/health", async () => ({ ok: true, now: new Date().toISOString() }));

server.register(async (fastify) => {
  fastify.register(authRoutes);
  fastify.register(deviceRoutes);
});

const start = async () => {
  try {
    // run migrations on startup (simple approach)
    await initMigrations();
    const port = Number(process.env.PORT || 4000);
    await server.listen({ port, host: "0.0.0.0" });
    server.log.info(`Server listening on ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();