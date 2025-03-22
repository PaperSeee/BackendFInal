// src/controllers/tokenController.js
const axios = require('axios');
const pLimit = require('p-limit');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const limit = pLimit(5);
let requestWeightCounter = 0;
const WEIGHT_LIMIT_PER_MINUTE = 1200;
const RESET_INTERVAL = 60000;
const MAX_RETRIES = 5;
const BASE_DELAY = 1000;

setInterval(() => requestWeightCounter = 0, RESET_INTERVAL);

async function makeRateLimitedRequest(requestFn, weight = 1, retryCount = 0) {
  if (requestWeightCounter + weight > WEIGHT_LIMIT_PER_MINUTE) {
    const waitTime = RESET_INTERVAL - (Date.now() % RESET_INTERVAL);
    await delay(waitTime);
  }
  requestWeightCounter += weight;
  
  try {
    return await limit(requestFn);
  } catch (error) {
    if (error.response?.status === 429 && retryCount < MAX_RETRIES) {
      const backoffDelay = BASE_DELAY * Math.pow(2, retryCount);
      await delay(backoffDelay);
      return makeRateLimitedRequest(requestFn, weight, retryCount + 1);
    }
    throw error;
  }
}

const config = {
  hyperliquidApiUrl: process.env.HYPERLIQUID_API_URL,
  hypurrscanApiUrl: process.env.HYPURRSCAN_API_URL,
};

const getSpotMeta = () => makeRateLimitedRequest(async () => {
  const response = await axios.post(config.hyperliquidApiUrl, { type: "spotMeta" });
  if (!response.data?.tokens) throw new Error('Invalid response for spotMeta.');
  return response.data.tokens.map(token => ({
    name: token.name,
    tokenId: token.tokenId,
    index: token.index
  }));
}, 20);

const getTokenDetails = (tokenId) => makeRateLimitedRequest(async () => {
  const response = await axios.post(config.hyperliquidApiUrl, { type: "tokenDetails", tokenId });
  if (!response.data?.name) throw new Error(`Details not found for tokenId: ${tokenId}`);
  return response.data;
}, 20);

async function updateTokenData(db) {
  try {
    // Récupère les tokens existants dans la base
    const currentTokens = await db.collection('allTokens').find({}).toArray();
    const startPxData = await db.collection('startPx').find({}).toArray();
    const spotTokens = await getSpotMeta();
    let hasChanges = false;
    
    for (const token of spotTokens) {
      // Vérifier par nom pour éviter les doublons
      const existingToken = currentTokens.find(t => t.name === token.name);
      try {
        const details = await getTokenDetails(token.tokenId);
        const startPxEntry = startPxData.find(t => t.index === token.index);
        const startPx = startPxEntry?.startPx || null;
        
        const tokenData = {
          name: token.name,
          tokenId: token.tokenId,
          index: token.index,
          tokenIndex: token.index,
          startPx,
          markPx: details.markPx || null,
          launchDate: details.deployTime ? details.deployTime.split('T')[0] : null,
          auctionPrice: details.seededUsdc && parseFloat(details.seededUsdc) !== 0
            ? (parseFloat(details.seededUsdc) / parseFloat(details.circulatingSupply)).toString()
            : null,
          launchCircSupply: details.circulatingSupply || null,
          launchMarketCap: startPx && details.circulatingSupply
            ? (parseFloat(startPx) * parseFloat(details.circulatingSupply)).toFixed(2)
            : null,
          lastUpdated: new Date().toISOString()
        };
        
        if (!existingToken) {
          console.log(`Nouveau token trouvé : ${token.name}`);
          await db.collection('allTokens').insertOne(tokenData);
          hasChanges = true;
        } else {
          // Mise à jour minimale pour ne pas écraser les champs modifiés manuellement
          await db.collection('allTokens').updateOne(
            { name: token.name },
            { $set: { markPx: details.markPx || existingToken.markPx, lastUpdated: new Date().toISOString() } }
          );
          hasChanges = true;
        }
      } catch (error) {
        console.error(`Erreur pour le token ${token.name} :`, error.message);
      }
    }
    
    if (hasChanges) {
      console.log('Données mises à jour à :', new Date().toISOString());
    }
  } catch (error) {
    console.error('Erreur lors de la mise à jour des tokens :', error.message);
  }
}

module.exports = {
  updateTokenData,
};
