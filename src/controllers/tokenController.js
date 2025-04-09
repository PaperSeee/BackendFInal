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
  // Utiliser directement l'URL qui fonctionne
  const response = await axios.post('https://api.hyperliquid.xyz/info', { 
    type: "spotMeta" 
  });
  
  if (!response.data?.tokens) throw new Error('Invalid API response for spotMeta.');
  return response.data.tokens.map(token => ({
    name: token.name,
    tokenId: token.tokenId,
    index: token.index
  }));
}, 20);

const getTokenDetails = (tokenId) => makeRateLimitedRequest(async () => {
  // Utiliser directement l'URL qui fonctionne au lieu de config.hyperliquidApiUrl
  const response = await axios.post('https://api.hyperliquid.xyz/info', { 
    type: "tokenDetails", 
    tokenId 
  });
  
  if (!response.data?.name) throw new Error(`Details not found for tokenId: ${tokenId}`);
  console.log(`Retrieved price for ${response.data.name}: ${response.data.markPx}`);
  return response.data;
}, 20);

async function updateTokenData(db) {
  try {
    const currentTokens = await db.collection('allTokens').find({}).toArray();
    const startPxData = await db.collection('startPx').find({}).toArray();
    const spotTokens = await getSpotMeta();
    let hasChanges = false;

    for (const token of spotTokens) {
      const existingToken = currentTokens.find(t => t.tokenIndex === token.index);

      try {
        const details = await getTokenDetails(token.tokenId);
        const startPxEntry = startPxData.find(t => t.index === token.index);
        const startPx = startPxEntry?.startPx || null;

        // Récupération des champs airdrop1 et airdrop2 depuis l'API
        const airdrop1 = details.airdrop1 !== undefined ? details.airdrop1 : existingToken?.airdrop1 || null;
        const airdrop2 = details.airdrop2 !== undefined ? details.airdrop2 : existingToken?.airdrop2 || null;

        console.log(`Processing token: ${token.name}`);
        console.log(`airdrop1: ${airdrop1}, airdrop2: ${airdrop2}`);

        const tokenData = {
          name: token.name,
          tokenId: token.tokenId,
          index: token.index,
          tokenIndex: token.index,
          startPx: startPx,
          markPx: details.markPx || null,
          launchDate: details.deployTime?.split('T')[0] || null,
          auctionPrice: details.seededUsdc && parseFloat(details.seededUsdc) !== 0
            ? (parseFloat(details.seededUsdc) / parseFloat(details.circulatingSupply)).toString()
            : null,
          launchCircSupply: details.circulatingSupply || null,
          launchMarketCap: startPx && details.circulatingSupply
            ? (parseFloat(startPx) * parseFloat(details.circulatingSupply)).toFixed(2)
            : null,
          teamAllocation: existingToken?.teamAllocation || null,
          airdrop1: airdrop1,
          airdrop2: airdrop2,
          devReputation: existingToken?.devReputation || false,
          spreadLessThanThree: existingToken?.spreadLessThanThree || false,
          thickObLiquidity: existingToken?.thickObLiquidity || false,
          noSellPressure: existingToken?.noSellPressure || false,
          twitter: existingToken?.twitter || "",
          telegram: existingToken?.telegram || "",
          discord: existingToken?.discord || "",
          website: existingToken?.website || "",
          comment: existingToken?.comment || "",
          lastUpdated: new Date().toISOString()
        };

        if (!existingToken) {
          console.log(`New token found: ${token.name}`);
          await db.collection('allTokens').insertOne(tokenData);
          hasChanges = true;
        } else {
          const updateResult = await db.collection('allTokens').updateOne(
            { tokenIndex: token.index },
            { $set: tokenData }
          );
          console.log(`Updated token: ${token.name}, Matched count: ${updateResult.matchedCount}`);
          hasChanges = true;
        }
      } catch (error) {
        console.error(`Error processing token ${token.name}:`, error.message);
      }
    }

    if (hasChanges) {
      console.log('Token data updated:', new Date().toISOString());
    }
  } catch (error) {
    console.error('Error during token update:', error.message);
  }
}

module.exports = {
  updateTokenData,
};
