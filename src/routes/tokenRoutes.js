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

// Add this route to your existing tokenRoutes.js file
router.post('/refresh', async (req, res) => {
  try {
    const db = await connectToDatabase();
    // Call the same function that updates the tokens
    await require('../controllers/tokenController').updateTokenData(db);
    res.status(200).json({ success: true, message: 'Token data refreshed successfully' });
  } catch (error) {
    console.error('Error refreshing data:', error);
    res.status(500).json({ success: false, message: 'Failed to refresh token data' });
  }
});

module.exports = router;
