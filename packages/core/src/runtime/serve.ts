export interface Server {
  stop(): void;
  port: number;
}

export function serve(
  fetch: (request: Request) => Response | Promise<Response>,
  options: { port: number; hostname: string },
): Server {
  const server = Bun.serve({
    fetch,
    port: options.port,
    hostname: options.hostname,
    // Bun closes idle sockets after 10 s by default, which would kill SSE streams.
    idleTimeout: 0,
  });
  return { stop: () => void server.stop(true), port: server.port ?? options.port };
}
