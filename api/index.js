const express = require('express');
const cors = require('cors');
require('dotenv').config();

const tokenRoutes = require('../src/routes/tokenRoutes');
const authRoutes = require('../src/routes/authRoutes');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Routes d'authentification
app.use('/api/auth', authRoutes);
// Routes de gestion des tokens
app.use('/api/tokens', tokenRoutes);

// Export pour Vercel
module.exports = app;