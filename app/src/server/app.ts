import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import morgan from 'morgan';
import { config } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { csrfProtection } from './middleware/csrf.js';
import authRoutes from './routes/auth.js';
import secretsRoutes from './routes/secrets.js';
import policiesRoutes from './routes/policies.js';
import authMethodsRoutes from './routes/authMethods.js';
import identityRoutes from './routes/identity.js';
import graphRoutes from './routes/graph.js';
import brandingRoutes from './routes/branding.js';
import sharingRoutes from './routes/sharing.js';
import permissionsRoutes from './routes/permissions.js';
import auditRoutes from './routes/audit.js';
import sysRoutes from './routes/sys.js';
import rotationRoutes from './routes/rotation.js';
import backupRoutes from './routes/backup.js';
import hooksRoutes from './routes/hooks.js';
import sysTokenSetupRoutes from './routes/sys-token-setup.js';

const app = express();

// Request ID middleware (Finding #21)
app.use((req, _res, next) => {
  (req as unknown as Record<string, unknown>).id = crypto.randomUUID();
  next();
});

// Security headers
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

if (config.nodeEnv === 'production') {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // Tailwind CSS ships fully pre-compiled styles in the bundle; no runtime
          // style injection is needed, so 'unsafe-inline' can be safely removed.
          // Google Fonts stylesheet is loaded from fonts.googleapis.com.
          styleSrc: ["'self'", 'https://fonts.googleapis.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          // Google Fonts font files are served from fonts.gstatic.com.
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          objectSrc: ["'none'"],
          // Deny framing to prevent clickjacking
          frameAncestors: ["'none'"],
          // Restrict form submissions to the same origin
          formAction: ["'self'"],
          // Block loading plugins
          baseUri: ["'self'"],
        },
      },
      // HSTS — 1 year, include subdomains
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
} else {
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
}

// CORS — only needed when corsOrigin is explicitly set (external consumers)
if (config.corsOrigin) {
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'LIST'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    })
  );
}

// Request logging with request ID
morgan.token('req-id', (req) => (req as unknown as Record<string, unknown>).id as string);
app.use(morgan(config.nodeEnv === 'production'
  ? ':req-id :remote-addr :method :url :status :res[content-length] - :response-time ms'
  : ':req-id :method :url :status :response-time ms'));

// Cookie parsing
app.use(cookieParser());

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Rate limiting — scoped to /api only so static assets are never throttled
// In development, use permissive limits to avoid blocking during testing
const limiter = rateLimit({
  windowMs: config.nodeEnv === 'development' ? 60 * 60 * 1000 : config.rateLimitWindowMs, // 1 hour window in dev
  max: config.nodeEnv === 'development' ? 10000 : config.rateLimitMax, // Very high limit in dev
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', limiter);

// Prevent caching of sensitive API responses by browsers and intermediary caches
// In development, allow caching for faster iteration cycles
app.use('/api', (_req, res, next) => {
  if (config.nodeEnv === 'development') {
    res.setHeader('Cache-Control', 'private, max-age=5');
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// HTTP parameter pollution protection
app.use(hpp());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes — login/logout/OIDC don't need CSRF (no existing session to protect)
app.use('/api/auth', authRoutes);

// CSRF protection for all state-changing API routes
app.use('/api', csrfProtection);

// Routes with mixed public/protected endpoints (CSRF applies to POST/PUT/DELETE)
app.use('/api/branding', brandingRoutes);
app.use('/api/sharing', sharingRoutes);

// Protected routes
app.use('/api/secrets', secretsRoutes);
app.use('/api/policies', policiesRoutes);
app.use('/api/auth-methods', authMethodsRoutes);
app.use('/api/identity', identityRoutes);
app.use('/api/graph', graphRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/sys', sysRoutes);
app.use('/api/rotation', rotationRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/hooks', hooksRoutes);
app.use('/api/sys-token-setup', sysTokenSetupRoutes);

// Error handling
app.use(errorHandler);

export default app;
