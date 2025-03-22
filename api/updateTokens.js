// src/cron/updateTokens.js
const { connectToDatabase } = require('../config/database');
const { updateTokenData } = require('../src/controllers/tokenController');

(async () => {
  try {
    const db = await connectToDatabase();
    await updateTokenData(db);
    console.log('La fonction de mise à jour a été exécutée avec succès.');
    process.exit(0);
  } catch (error) {
    console.error('Erreur lors de l’exécution de la fonction de mise à jour :', error);
    process.exit(1);
  }
})();
