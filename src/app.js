// src/app.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const tokenRoutes = require('./routes/tokenRoutes');
const authRoutes = require('./routes/authRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Routes d'authentification
app.use('/api/auth', authRoutes);
// Routes de gestion des tokens
app.use('/api/tokens', tokenRoutes);

app.listen(PORT, () => {
  console.log(`API server is running on port ${PORT}`);
});

module.exports = app;
