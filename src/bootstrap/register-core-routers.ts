import type * as express from 'express';

export function registerCoreRouters(options: {
  app: express.Express;
  discoveryRouter: express.Router;
  authorityRouter?: express.Router;
  ledgerRouter: express.Router;
  apiRouter: express.Router;
  networkRouter: express.Router;
  fhirRouter: express.Router;
  webhooksRouter: express.Router;
  authRouter: express.Router;
}): void {
  const {
    app,
    discoveryRouter,
    authorityRouter,
    ledgerRouter,
    apiRouter,
    networkRouter,
    fhirRouter,
    webhooksRouter,
    authRouter,
  } = options;

  app.use('/', discoveryRouter);
  if (authorityRouter) {
    app.use('/', authorityRouter);
  }
  app.use('/', ledgerRouter);
  app.use('/', apiRouter);
  app.use('/', networkRouter);
  app.use('/', fhirRouter);
  app.use('/webhooks', webhooksRouter);
  app.use('/auth', authRouter);
}

