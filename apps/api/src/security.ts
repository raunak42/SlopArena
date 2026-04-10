import type { NextFunction, Request, Response, RequestHandler } from "express";
import type { CorsOptionsDelegate } from "cors";

const LOCAL_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

interface RateLimiterOptions {
  keyPrefix: string;
  windowMs: number;
  max: number;
  message: string;
}

export function createCorsOptions(webUrl: string): CorsOptionsDelegate<Request> {
  const allowedOrigins = new Set(LOCAL_ORIGINS);

  try {
    allowedOrigins.add(new URL(webUrl).origin);
  } catch {
    // Ignore invalid configured web URLs and keep localhost fallbacks.
  }

  return (request, callback) => {
    const origin = request.header("origin");
    if (!origin) {
      callback(null, { origin: false });
      return;
    }

    callback(null, {
      origin: allowedOrigins.has(origin) ? origin : false,
      methods: ["GET", "POST", "OPTIONS"],
    });
  };
}

export function applySecurityHeaders(request: Request, response: Response, next: NextFunction): void {
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cross-Origin-Resource-Policy", "same-site");

  if (request.path.startsWith("/api/auth/")) {
    response.setHeader("Cache-Control", "no-store");
  }

  next();
}

export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (request, response, next) => {
    const now = Date.now();
    const ip = request.ip || request.socket.remoteAddress || "unknown";
    const key = `${options.keyPrefix}:${ip}`;
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (current.count >= options.max) {
      response.status(429).json({ error: options.message });
      return;
    }

    current.count += 1;
    hits.set(key, current);

    if (hits.size > 5000) {
      for (const [entryKey, entry] of hits.entries()) {
        if (entry.resetAt <= now) {
          hits.delete(entryKey);
        }
      }
    }

    next();
  };
}

export function isValidAuthState(value: string): boolean {
  return value.length >= 16 && value.length <= 200 && /^[A-Za-z0-9_-]+$/.test(value);
}
