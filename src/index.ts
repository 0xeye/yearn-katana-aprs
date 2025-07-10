import express from 'express';
import { config } from './config';
import { DataCacheService } from './services/dataCache';

const app = express();
const dataCacheService = new DataCacheService();

// Middleware
app.use(express.json());

// Health check
app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(config.port, async () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Connected to Katana chain (${config.katanaChainId})`);

  // Generate initial APR data
  await dataCacheService.generateVaultAPRData();

  // Refresh data every 5 minutes
  setInterval(
    () => {
      dataCacheService.generateVaultAPRData();
    },
    5 * 60 * 1000
  );
});
