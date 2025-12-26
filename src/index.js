// FILE: src/index.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');

dotenv.config();

// Import routes
const authRoutes = require('./routes/auth');
const qrRoutes = require('./routes/qr');
const analyticsRoutes = require('./routes/analytics');
const usersRoutes = require('./routes/users');
const billingRoutes = require('./routes/billing');
const pauseRoutes = require('./routes/pause');
const a2arRoutes = require('./routes/a2ar');

// Import v1 API routes
const v1EventsRoutes = require('./routes/v1/events');
const v1PublishersRoutes = require('./routes/v1/publishers');
const v1TestRoutes = require('./routes/v1/test');

const app = express();

// =====================
// Middleware
// =====================

// Trust proxy (required for express-rate-limit behind reverse proxies)
app.set('trust proxy', 1);

// Security headers
app.use(helmet());

// JSON parsing
app.use(express.json());

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || '*',
    optionsSuccessStatus: 200,
  })
);

// =====================
// Rate Limiter
// =====================
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'), // default 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),              // default 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,  // important for proxies
});

app.use(limiter);

// =====================
// Routes
// =====================
app.use('/auth', authRoutes);
app.use('/qr', qrRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api', billingRoutes);
app.use('/pause', pauseRoutes);
app.use('/api/pause', pauseRoutes);
app.use('/a2ar', a2arRoutes);
app.use('/api/a2ar', a2arRoutes);

// =====================
// V1 API Routes (Publisher Event API)
// =====================
app.use('/v1', v1EventsRoutes);
app.use('/v1', v1PublishersRoutes);
app.use('/v1', v1TestRoutes);

// Health check
app.get('/', (req, res) => res.json({ ok: true, msg: 'iPauseAds backend running' }));

// Health check with version info
app.get('/health', (req, res) => res.json({ 
  status: 'ok',
  version: '1.0',
  api_versions: ['v1'],
  timestamp: new Date().toISOString()
}));

// 404 handler for API routes
app.use('/v1/*', (req, res) => {
  res.status(404).json({ 
    error: 'not_found',
    message: 'Endpoint not found'
  });
});

// =====================
// Server + Database
// =====================
const PORT = process.env.PORT || 4000;

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log('Connected to MongoDB Atlas');
    app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
