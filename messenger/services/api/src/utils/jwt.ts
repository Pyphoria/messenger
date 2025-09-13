import fastifyJwt from "fastify-jwt";
import { FastifyInstance } from "fastify";
import dotenv from "dotenv";
dotenv.config();

declare module "fastify" {
  export interface FastifyInstance {
    authenticate: any;
  }
}

export function registerJwt(fastify: FastifyInstance) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  fastify.register(fastifyJwt, { secret });

  fastify.decorate("authenticate", async function (request: any, reply: any) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });
}