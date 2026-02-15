import 'dotenv/config';
import cors from 'cors';
import path from 'path';
import express from 'express';
import http from 'http';
import connectMongoDB from './config/db.js';
import cookieParser from 'cookie-parser';

import authsRoutes from './routes/authsRoutes.js';
import accountsRoutes from './routes/accountsRoutes.js';
import transactionsRoutes from './routes/transactionsRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import { initSocketServer } from './socket/socketServer.js';

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

/* ---------- Middlewares ---------- */


app.use(express.json());
app.use(cookieParser());

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://bank-11-frontend.vercel.app'
  ],
  credentials: true,
}));

app.use('/logo', express.static(path.join(process.cwd(), 'logo')));

/* ---------- Routes ---------- */
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/auth', authsRoutes);
app.use('/api/v1/accounts', accountsRoutes);
app.use('/api/v1/transactions', transactionsRoutes);

initSocketServer(server);

/* ---------- Start server ---------- */
const startServer = async () => {
  await connectMongoDB();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
