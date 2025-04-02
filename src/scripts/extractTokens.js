// Extrait les tokens de la base de données vers un fichier JSON
const fs = require('fs');
const path = require('path');
const { connectToDatabase } = require('../config/database');

async function extractTokens() {
  try {
    console.log('Connexion à la base de données...');
    const db = await connectToDatabase();
    
    console.log('Récupération des tokens...');
    const tokens = await db.collection('allTokens').find({}).toArray();
    
    // Création du répertoire data s'il n'existe pas
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Écriture des données dans un fichier JSON
    const filePath = path.join(dataDir, 'tokens.json');
    fs.writeFileSync(filePath, JSON.stringify(tokens, null, 2));
    
    console.log(`${tokens.length} tokens exportés avec succès vers ${filePath}`);
    process.exit(0);
  } catch (error) {
    console.error('Erreur lors de l\'extraction des tokens:', error);
    process.exit(1);
  }
}

// Exécuter la fonction si appelé directement
if (require.main === module) {
  extractTokens();
}

module.exports = extractTokens;