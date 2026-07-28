import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeDatabase } from './models/behavior.model.js';
import behaviorRoutes from './routes/behavior.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { initializeIntegrityBaselines } from './services/integrity.service.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*', // For PoC, allow all origins
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Routes
app.use('/', behaviorRoutes);
app.use('/admin', adminRoutes);

// Healthcheck/status endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', time: new Date() });
});

// Start DB, Integrity Engine, and then Express Server
async function startServer() {
  try {
    await initializeDatabase();
    
    // Initialize & verify Admin-Side System Integrity Baselines
    console.log('[System Integrity] Initializing SHA-256 integrity baseline verification...');
    const integrityStatus = initializeIntegrityBaselines();
    console.log(`[System Integrity] Status: ${integrityStatus.overallStatus} (${integrityStatus.totalProtectedComponents} assets verified)`);

    app.listen(PORT, () => {
      console.log(`==================================================`);
      console.log(` Behavioral Biometrics Server is running on port ${PORT}`);
      console.log(` Admin Integrity API mounted at: http://localhost:${PORT}/admin`);
      console.log(` Healthcheck available at: http://localhost:${PORT}/health`);
      console.log(`==================================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
