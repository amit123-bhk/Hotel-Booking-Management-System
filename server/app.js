const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

const authRoutes = require('./routes/authRoutes');
const roomRoutes = require('./routes/roomRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const reportRoutes = require('./routes/reportRoutes');
const auditRoutes = require('./routes/auditRoutes');
const { requireAuth, requireRole } = require('./middleware/auth');
const { createRateLimiter, verifyHumanSubmission } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');
const { getDb, col, getNextId } = require('./db/database');

const app = express();
app.set('trust proxy', 1);

const KNOWN_FRONTEND_ROUTES = new Set([
  '/',
  '/rooms',
  '/login',
  '/register',
  '/bookings',
  '/front-desk',
  '/housekeeping',
  '/reports',
  '/admin/rooms',
  '/admin/audit',
  '/privacy',
  '/terms'
]);

// Security Headers & Force HTTPS Middleware (for production / reverse-proxy deployments)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '';
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forceHttps = process.env.FORCE_HTTPS === 'true';

  if (forwardedProto === 'http' || (forceHttps && !req.secure && !isLocalHost)) {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }

  if (req.secure || forwardedProto === 'https' || forceHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
});

// Request body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Idempotency-Key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve OpenAPI Specification JSON
const openApiPath = path.join(__dirname, 'docs', 'openapi.json');
app.get('/api/openapi.json', (req, res) => {
  res.sendFile(openApiPath);
});

// Interactive API Documentation Explorer at /api/docs
app.get('/api/docs', (req, res) => {
  const openApiDoc = fs.readFileSync(openApiPath, 'utf8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Grand Horizon Hotel - API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; padding: 0; background-color: #f6f5f0; font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #141413; }
    .top-header { background: #ffffff; color: #141413; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #dcd9d0; }
    .top-header h1 { margin: 0; font-size: 1.125rem; font-weight: 700; color: #141413; }
    .top-header a { color: #14362b; text-decoration: underline; font-size: 0.875rem; font-weight: 600; margin-left: 16px; }
    .swagger-ui { background: #ffffff; border: 1px solid #dcd9d0; border-radius: 8px; margin: 24px auto; max-width: 1280px; padding: 20px; }
  </style>
</head>
<body>
  <div class="top-header">
    <h1>Grand Horizon Hotel: Interactive API Documentation</h1>
    <div>
      <a href="/" target="_blank">Open Hotel Web Application</a>
      <a href="/api/openapi.json" target="_blank">Raw OpenAPI JSON</a>
    </div>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      const spec = ${openApiDoc};
      SwaggerUIBundle({
        spec: spec,
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`);
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api', roomRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/audit', auditRoutes);

const inquiryLimiter = createRateLimiter({ windowMs: 60 * 1000, maxRequests: 25 });

// Contact / Front Desk Inquiry endpoint (bot-protected & stored in MongoDB)
app.post('/api/inquiries', inquiryLimiter, verifyHumanSubmission, async (req, res, next) => {
  try {
    const { name, email, subject, message, utm } = req.body || {};
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: { message: 'Name, email, and message are required.', status: 400 }
      });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(email).trim())) {
      return res.status(400).json({
        success: false,
        error: { message: 'Please enter a valid email address.', status: 400 }
      });
    }

    const id = await getNextId('inquiries');
    const inquiry = {
      id,
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      subject: subject ? String(subject).trim() : 'General Inquiry',
      message: String(message).trim(),
      utm: utm || null,
      status: 'OPEN',
      created_at: new Date().toISOString()
    };
    await col('inquiries').insertOne(inquiry);
    res.status(201).json({
      success: true,
      data: { id: inquiry.id, status: inquiry.status, created_at: inquiry.created_at }
    });
  } catch (err) {
    next(err);
  }
});

// First-Party Analytics Event Ingestion (Stored in MongoDB)
const analyticsLimiter = createRateLimiter({ windowMs: 60 * 1000, maxRequests: 120 });
app.post('/api/analytics/event', analyticsLimiter, async (req, res, next) => {
  try {
    const { event, path: pagePath, utm, metadata } = req.body || {};
    if (!event) {
      return res.status(400).json({
        success: false,
        error: { message: 'Event name is required', status: 400 }
      });
    }
    const allowedEvents = new Set(['page_view', 'search_availability', 'hold_created', 'booking_confirmed', 'inquiry_submitted']);
    if (!allowedEvents.has(String(event))) {
      return res.status(400).json({
        success: false,
        error: { message: 'Unsupported analytics event type', status: 400 }
      });
    }

    const id = await getNextId('analytics_events');
    await col('analytics_events').insertOne({
      id,
      event: String(event),
      path: pagePath ? String(pagePath).slice(0, 200) : '/',
      utm: utm || null,
      metadata: metadata || null,
      created_at: new Date().toISOString()
    });
    res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Admin Analytics Summary Endpoint
app.get('/api/analytics/summary', requireAuth, requireRole('ADMIN', 'STAFF'), async (req, res, next) => {
  try {
    const events = await col('analytics_events').find({}, { projection: { _id: 0 } }).toArray();
    const counts = {};
    events.forEach((e) => {
      counts[e.event] = (counts[e.event] || 0) + 1;
    });
    res.json({
      success: true,
      data: {
        total_events: events.length,
        event_counts: counts
      }
    });
  } catch (err) {
    next(err);
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    await getDb().command({ ping: 1 });
    res.json({
      status: 'healthy',
      database: 'mongodb',
      database_status: 'connected',
      timestamp: new Date().toISOString(),
      service: 'Grand Horizon Hotel API',
      uptime: process.uptime()
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'mongodb',
      database_status: 'disconnected',
      error: err.message
    });
  }
});

// Dynamic Sitemap XML
app.get('/sitemap.xml', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const urls = [
    { path: '/', priority: '1.0', freq: 'daily' },
    { path: '/rooms', priority: '0.9', freq: 'daily' },
    { path: '/login', priority: '0.6', freq: 'monthly' },
    { path: '/bookings', priority: '0.7', freq: 'weekly' },
    { path: '/privacy', priority: '0.4', freq: 'monthly' },
    { path: '/terms', priority: '0.4', freq: 'monthly' }
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${baseUrl}${u.path}</loc>
    <lastmod>2026-11-11</lastmod>
    <changefreq>${u.freq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
  res.type('application/xml').send(xml);
});

// Static client assets with aggressive caching for compressed images & icons
const clientPath = path.join(__dirname, '..', 'client');
app.use('/assets', express.static(path.join(clientPath, 'assets'), { maxAge: '7d', etag: true }));
app.use(express.static(clientPath, { etag: true }));

// 404 handler for unmatched API routes
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: `API endpoint not found: ${req.method} ${req.originalUrl}`,
      code: 'NOT_FOUND',
      status: 404
    }
  });
});

// SPA routing & Custom HTTP 404 page for unknown frontend routes
app.use((req, res, next) => {
  if (req.method === 'GET') {
    const status = KNOWN_FRONTEND_ROUTES.has(req.path) ? 200 : 404;
    return res.status(status).sendFile(path.join(clientPath, 'index.html'));
  }
  next();
});

// Centralized Error Handling
app.use(errorHandler);

module.exports = app;
