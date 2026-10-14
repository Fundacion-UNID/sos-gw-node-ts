import { startServer } from './server';

startServer()
  .then((runtime) => {
    let stopping = false;
    const stop = async (signal: NodeJS.Signals) => {
      if (stopping) return;
      stopping = true;
      console.log(`[GW-API] Received ${signal}; closing async consumer and HTTP server.`);
      try {
        await runtime.queueAdapter.close?.();
        await new Promise<void>((resolve, reject) => {
          if (!runtime.server) return resolve();
          runtime.server.close((error) => error ? reject(error) : resolve());
        });
        process.exit(0);
      } catch (error) {
        console.error('[GW-API] Graceful shutdown failed:', error);
        process.exit(1);
      }
    };
    process.once('SIGTERM', () => { void stop('SIGTERM'); });
    process.once('SIGINT', () => { void stop('SIGINT'); });
  })
  .catch((error) => {
    console.error('[GW-API] Failed to start server:', error);
    process.exit(1);
  });
