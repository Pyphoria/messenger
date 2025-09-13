import { FastifyInstance } from "fastify";
import fastifyWebsocket from "fastify-websocket";
import { pool } from "../db/index.js";

interface WSConn {
  socket: any;
  userId: string;
  deviceId: string;
}

export async function wsRoutes(fastify: FastifyInstance) {
  // register the plugin
  fastify.register(fastifyWebsocket);

  // in-memory map deviceId -> connection
  // NOTE: in prod, use a distributed store (Redis Pub/Sub) for multiple API instances.
  const connections = new Map<string, WSConn>();

  // Helper: send JSON safely
  function safeSend(socket: any, obj: any) {
    try {
      socket.send(JSON.stringify(obj));
    } catch (err) {
      fastify.log.error("ws send error", err);
    }
  }

  fastify.get(
    "/ws",
    { websocket: true },
    async (connection /* SocketStream */, req /* FastifyRequest */) => {
      const { socket } = connection as any;
      // Try to read token from query or Authorization header
      const url = (req.raw.url || "");
      const params = new URLSearchParams(url.split("?")[1] || "");
      let token = params.get("token") || "";

      if (!token) {
        // try header
        const authHeader = (req.headers["authorization"] as string) || "";
        if (authHeader.startsWith("Bearer ")) token = authHeader.slice(7);
      }

      let decoded: any = null;
      try {
        if (!token) throw new Error("token missing");
        decoded = await (fastify as any).jwt.verify(token);
      } catch (err) {
        safeSend(socket, { type: "error", message: "auth failed" });
        socket.close();
        return;
      }

      // Upon connect client must send a register message with deviceId
      // we'll time out if deviceId not provided in N seconds
      let registered = false;
      let thisConn: WSConn | null = null;

      const registerTimeout = setTimeout(() => {
        if (!registered) {
          safeSend(socket, { type: "error", message: "device registration timed out" });
          socket.close();
        }
      }, 10_000); // 10s to register

      socket.on("message", async (raw: string) => {
        let msg: any;
        try {
          msg = JSON.parse(raw.toString());
        } catch (err) {
          safeSend(socket, { type: "error", message: "invalid json" });
          return;
        }

        // handle register
        if (msg.type === "register") {
          const deviceId = msg.deviceId as string;
          if (!deviceId) {
            safeSend(socket, { type: "error", message: "deviceId required for register" });
            return;
          }
          registered = true;
          clearTimeout(registerTimeout);

          thisConn = { socket, userId: decoded.userId, deviceId };
          connections.set(deviceId, thisConn);

          // update last_seen in DB for device (best-effort)
          try {
            await pool.query(`UPDATE devices SET last_seen = now() WHERE id = $1`, [deviceId]);
          } catch (err) {
            fastify.log.warn("failed to update last_seen", err);
          }

          safeSend(socket, { type: "registered", deviceId });
          fastify.log.info(`WS: user ${decoded.userId} registered device ${deviceId}`);
          return;
        }

        // Must be registered to send other messages
        if (!registered || !thisConn) {
          safeSend(socket, { type: "error", message: "not registered (send {type:'register', deviceId})" });
          return;
        }

        // handle outgoing message (relay)
        if (msg.type === "message") {
          const { toDevice, payload } = msg;
          if (!toDevice || !payload) {
            safeSend(socket, { type: "error", message: "toDevice & payload required" });
            return;
          }

          const fromDevice = thisConn.deviceId;

          // if recipient connected -> send directly
          const recipientConn = connections.get(toDevice);
          if (recipientConn) {
            safeSend(recipientConn.socket, {
              type: "message",
              fromDevice,
              payload,
              sent_at: new Date().toISOString()
            });

            // optionally persist message with delivered=true
            try {
              await pool.query(
                `INSERT INTO messages (from_device, to_device, payload, delivered) VALUES ($1,$2,$3, TRUE)`,
                [fromDevice, toDevice, payload]
              );
            } catch (err) {
              fastify.log.error("db insert error (delivered)", err);
            }

            // ack to sender
            safeSend(socket, { type: "ack", status: "delivered", toDevice });
          } else {
            // store for later delivery (delivered = false)
            try {
              await pool.query(
                `INSERT INTO messages (from_device, to_device, payload, delivered) VALUES ($1,$2,$3, FALSE)`,
                [fromDevice, toDevice, payload]
              );
              safeSend(socket, { type: "ack", status: "stored", toDevice });
            } catch (err) {
              fastify.log.error("db insert error (stored)", err);
              safeSend(socket, { type: "error", message: "db error" });
            }
          }
          return;
        }

        // signaling messages for WebRTC can be proxied similarly
        if (msg.type === "signal") {
          const { toDevice, signal } = msg;
          if (!toDevice || !signal) {
            safeSend(socket, { type: "error", message: "toDevice & signal required" });
            return;
          }
          const recipientConn = connections.get(toDevice);
          if (recipientConn) {
            safeSend(recipientConn.socket, {
              type: "signal",
              fromDevice: thisConn!.deviceId,
              signal
            });
            safeSend(socket, { type: "ack", status: "signaled", toDevice });
          } else {
            safeSend(socket, { type: "error", message: "recipient offline" });
          }
          return;
        }

        // unknown type
        safeSend(socket, { type: "error", message: "unknown message type" });
      });

      socket.on("close", () => {
        if (thisConn) {
          connections.delete(thisConn.deviceId);
          fastify.log.info(`WS: disconnected ${thisConn.deviceId}`);
        } else {
          fastify.log.info("WS: disconnected (unregistered)");
        }
      });

      socket.on("error", (err: any) => {
        fastify.log.warn("ws socket error", err);
      });

      // On connect: try to deliver queued messages for this device after registration.
      // (delivery will happen after client sends register message)
    }
  );

  // Utility: when a client registers, we want to push stored messages.
  // Because the registration handler above knows connections Map, we'll add a simple periodic sweep
  // that tries to deliver messages for connected devices on interval.
  setInterval(async () => {
    if (connections.size === 0) return;
    try {
      // fetch undelivered messages for all connected deviceIds
      const deviceIds = Array.from(connections.keys());
      const res = await pool.query(
        `SELECT id, from_device, to_device, payload FROM messages WHERE delivered = FALSE AND to_device = ANY($1::uuid[])`,
        [deviceIds]
      );
      for (const row of res.rows) {
        const conn = connections.get(row.to_device);
        if (!conn) continue;
        safeSend(conn.socket, {
          type: "message",
          fromDevice: row.from_device,
          payload: row.payload,
          storedMessageId: row.id
        });
        // mark delivered
        await pool.query(`UPDATE messages SET delivered = TRUE WHERE id = $1`, [row.id]);
      }
    } catch (err) {
      fastify.log.error("error during queued message delivery", err);
    }
  }, 3000); // every 3s - tune as needed
}