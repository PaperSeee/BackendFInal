// src/routes/tokenRoutes.js
const express = require('express');
const router = express.Router();
const { connectToDatabase } = require('../config/database');
const authMiddleware = require('../middleware/auth');

// Endpoint pour récupérer tous les tokens (accessible à tous)
router.get('/', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const tokens = await db.collection('allTokens').find({}).toArray();
    res.json(tokens);
  } catch (error) {
    res.status(500).json({ error: 'Error retrieving tokens' });
  }
});

// Endpoint pour mettre à jour un token (protégé)
router.put('/:tokenIndex', authMiddleware, async (req, res) => {
  try {
    const tokenIndex = parseInt(req.params.tokenIndex, 10);
    const updates = { ...req.body, lastUpdated: new Date().toISOString() };
    const db = await connectToDatabase();
    const result = await db.collection('allTokens').findOneAndUpdate(
      { tokenIndex },
      { $set: updates },
      { returnDocument: 'after' }
    );
    if (!result.value) {
      return res.status(404).json({ error: 'Token not found' });
    }
    res.json({ message: 'Token updated successfully', token: result.value });
  } catch (error) {
    res.status(500).json({ error: 'Error updating token' });
  }
});

module.exports = router;
