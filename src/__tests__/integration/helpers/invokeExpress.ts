// src/__tests__/integration/helpers/invokeExpress.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

export type InMemoryResponse = {
  status: number;
  headers: Record<string, string>;
  text: string;
};

export async function invokeExpress(
  handler: any,
  options: { method: string; url: string; headers?: Record<string, string>; body?: any },
): Promise<InMemoryResponse> {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let responseText = '';

  const req = {
    method: options.method.toUpperCase(),
    url: options.url,
    originalUrl: options.url,
    headers: Object.fromEntries(Object.entries(options.headers || {}).map(([k, v]) => [k.toLowerCase(), v])),
    body: options.body,
    query: {},
    get(name: string) {
      return this.headers[name.toLowerCase()];
    },
    connection: {},
    socket: {},
  };

  try {
    const parsed = new URL(options.url, 'http://localhost');
    req.query = Object.fromEntries(parsed.searchParams.entries());
  } catch {
    // Ignore malformed URLs in tests.
  }

  let resolveFinished: (() => void) | undefined;
  let rejectFinished: ((err: any) => void) | undefined;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  const res = {
    statusCode,
    headersSent: false,
    finished: false,
    locals: {},
    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    set(field: string, value: string) {
      headers[field.toLowerCase()] = value;
      return this;
    },
    header(field: string, value: string) {
      return this.set(field, value);
    },
    setHeader(field: string, value: string) {
      headers[field.toLowerCase()] = value;
      return this;
    },
    getHeader(field: string) {
      return headers[field.toLowerCase()];
    },
    getHeaders() {
      return { ...headers };
    },
    removeHeader(field: string) {
      delete headers[field.toLowerCase()];
    },
    append(field: string, value: string) {
      const key = field.toLowerCase();
      const existing = headers[key];
      headers[key] = existing ? `${existing}, ${value}` : value;
      return this;
    },
    location(value: string) {
      headers['location'] = value;
      return this;
    },
    type(value: string) {
      headers['content-type'] = value;
      return this;
    },
    writeHead(code: number, extraHeaders?: Record<string, string>) {
      this.status(code);
      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) this.setHeader(k, v);
      }
      return this;
    },
    write(chunk: any) {
      if (chunk === undefined || chunk === null) return true;
      responseText += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      return true;
    },
    send(payload: any) {
      if (payload === undefined || payload === null) {
        responseText = '';
      } else if (typeof payload === 'string') {
        responseText = payload;
      } else {
        if (!headers['content-type']) headers['content-type'] = 'application/json';
        responseText = JSON.stringify(payload);
      }
      this.headersSent = true;
      this.finished = true;
      resolveFinished?.();
      return this;
    },
    json(payload: any) {
      headers['content-type'] = 'application/json';
      responseText = JSON.stringify(payload);
      this.headersSent = true;
      this.finished = true;
      resolveFinished?.();
      return this;
    },
    end(payload?: any) {
      if (payload !== undefined) {
        this.send(payload);
      } else {
        this.headersSent = true;
        this.finished = true;
        resolveFinished?.();
      }
      return this;
    },
  };

  const handleFn = (typeof handler === 'function' ? handler : handler?.handle) as
    | ((req: any, res: any, next: (err?: any) => void) => void)
    | undefined;
  if (!handleFn) throw new Error('invokeExpress: handler has no handle()');

  handleFn(req, res, (err?: any) => {
    if (err) rejectFinished?.(err);
    else resolveFinished?.();
  });

  await finished;

  return { status: statusCode, headers, text: responseText };
}
