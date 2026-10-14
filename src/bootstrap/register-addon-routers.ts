import type * as express from 'express';

export type AddonRouterRegistration = {
  mountPath: string;
  router: express.Router;
};

export function registerAddonRouters(
  app: express.Express,
  registrations: AddonRouterRegistration[],
): void {
  for (const registration of registrations) {
    app.use(registration.mountPath, registration.router);
  }
}

