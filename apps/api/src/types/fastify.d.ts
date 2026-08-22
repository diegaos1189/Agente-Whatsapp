import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Buffer crudo del body, capturado para poder verificar la firma HMAC de webhooks (ej: Meta). */
    rawBody?: Buffer;
  }
}
