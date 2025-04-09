const axios = require('axios');

async function testNewInfoAPI() {
  try {
    console.log("Testing new Info API endpoint...");
    const response = await axios.post('https://api.hyperliquid.xyz/info', {
      "type": "meta"
    });
    console.log("Response status:", response.status);
    console.log("Response sample:", JSON.stringify(response.data).substring(0, 500) + "...");
    
    // Rechercher HFUN spécifiquement
    if (response.data && Array.isArray(response.data.universe)) {
      const hfun = response.data.universe.find(token => token.name === "HFUN");
      if (hfun) {
        console.log("\nHFUN details:", JSON.stringify(hfun, null, 2));
      } else {
        console.log("\nHFUN not found in response");
      }
    }
    
    return response.data;
  } catch (error) {
    console.error("Error:", error.message);
    console.error("Error details:", error.response?.data || 'No additional error details');
    console.error("Status code:", error.response?.status);
  }
}

// Test l'endpoint avec spotMeta pour récupérer les informations de base sur les tokens
async function testSpotMeta() {
  try {
    console.log("1. Test de l'endpoint spotMeta...");
    const response = await axios.post('https://api.hyperliquid.xyz/info', {
      "type": "spotMeta"
    });
    
    console.log("Statut de la réponse:", response.status);
    
    // Recherche HFUN dans le tableau des tokens
    const hfun = response.data?.tokens?.find(token => token.name === "HFUN");
    if (hfun) {
      console.log("HFUN trouvé:", JSON.stringify(hfun, null, 2));
      return hfun.tokenId;
    } else {
      console.log("HFUN non trouvé dans la réponse spotMeta");
      // Utiliser l'ID connu de la documentation
      return "0xbaf265ef389da684513d98d68edf4eae";
    }
  } catch (error) {
    console.error("Erreur:", error.message);
    console.error("Détails:", error.response?.data || 'Pas de détails supplémentaires');
    // Utiliser l'ID connu par défaut
    return "0xbaf265ef389da684513d98d68edf4eae";
  }
}

// Test l'endpoint tokenDetails pour HFUN
async function testTokenDetails(tokenId) {
  try {
    console.log("\n2. Test de l'endpoint tokenDetails pour HFUN...");
    console.log("Utilisation du tokenId:", tokenId);
    
    const response = await axios.post('https://api.hyperliquid.xyz/info', {
      "type": "tokenDetails",
      "tokenId": tokenId
    });
    
    console.log("Statut de la réponse:", response.status);
    console.log("Détails du token HFUN:", JSON.stringify(response.data, null, 2));
    
    // Extraire les champs importants
    const { name, markPx, circulatingSupply, deployTime } = response.data;
    console.log("\nRésumé:");
    console.log(`Nom: ${name}`);
    console.log(`Prix actuel: ${markPx}`);
    console.log(`Supply circulante: ${circulatingSupply}`);
    console.log(`Date de déploiement: ${deployTime}`);
    
    return response.data;
  } catch (error) {
    console.error("Erreur:", error.message);
    console.error("Détails:", error.response?.data || 'Pas de détails supplémentaires');
    console.error("Code d'erreur:", error.response?.status);
  }
}

// Test l'endpoint spotMetaAndAssetCtxs pour les données de marché
async function testSpotMetaAndAssetCtxs() {
  try {
    console.log("\n3. Test de l'endpoint spotMetaAndAssetCtxs...");
    const response = await axios.post('https://api.hyperliquid.xyz/info', {
      "type": "spotMetaAndAssetCtxs"
    });
    
    console.log("Statut de la réponse:", response.status);
    
    if (Array.isArray(response.data) && response.data.length >= 2) {
      const metaData = response.data[0];
      const marketData = response.data[1];
      
      // Trouver l'index de HFUN dans les tokens
      const hfunToken = metaData.tokens.find(token => token.name === "HFUN");
      if (hfunToken) {
        console.log("HFUN trouvé dans les métadonnées:", JSON.stringify(hfunToken, null, 2));
        
        // Trouver la paire de trading HFUN/USDC
        const hfunIndex = hfunToken.index;
        const hfunPair = metaData.universe.find(pair => pair.tokens.includes(hfunIndex));
        
        if (hfunPair) {
          const pairIndex = hfunPair.index;
          const hfunMarketData = marketData[pairIndex];
          
          console.log("Données de marché pour HFUN:", JSON.stringify(hfunMarketData, null, 2));
          console.log("\nPrix actuel de HFUN:", hfunMarketData.markPx);
        } else {
          console.log("Paire de trading HFUN non trouvée");
        }
      } else {
        console.log("HFUN non trouvé dans les métadonnées");
      }
    } else {
      console.log("Format de réponse inattendu");
    }
  } catch (error) {
    console.error("Erreur:", error.message);
    console.error("Détails:", error.response?.data || 'Pas de détails supplémentaires');
    console.error("Code d'erreur:", error.response?.status);
  }
}

// Exécuter tous les tests en séquence
async function runAllTests() {
  try {
    // D'abord récupérer le tokenId
    const tokenId = await testSpotMeta();
    
    // Puis tester les autres endpoints
    await testTokenDetails(tokenId);
    await testSpotMetaAndAssetCtxs();
    
    console.log("\nTous les tests sont terminés");
  } catch (error) {
    console.error("Erreur lors de l'exécution des tests:", error);
  }
}

// Lancer les tests
runAllTests();