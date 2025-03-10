const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { MongoClient } = require('mongodb');

require('dotenv').config();

// Function to validate and ensure correct MongoDB URI format
function getValidMongoURI() {
  let uri = process.env.MONGO_URI;
  
  if (!uri) {
    console.error('MONGO_URI is not defined in the environment variables');
    console.error('Setting default connection string');
    uri = "mongodb+srv://Paper:Coucou@hypurrspot.pezxc.mongodb.net/?retryWrites=true&w=majority&appName=HypurrSpot";
  }

  // Clean the URI - trim whitespace and ensure proper format
  uri = uri.trim();
  
  // Check if the URI has the correct prefix
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    console.error('Invalid MongoDB URI format, adding proper prefix');
    if (uri.includes('@') && uri.includes('.')) {
      // Likely just missing the prefix
      uri = 'mongodb+srv://' + uri;
    } else {
      throw new Error('MongoDB URI is incorrectly formatted and cannot be automatically fixed');
    }
  }
  
  console.log('MongoDB URI format validation passed');
  return uri;
}

// Get a properly formatted MongoDB URI
let mongoURI;
try {
  mongoURI = getValidMongoURI();
  // Only log the sanitized version for security
  console.log('Connection URI (sanitized):', mongoURI.replace(/:[^:@]*@/, ':****@'));
} catch (error) {
  console.error('Fatal error with MongoDB URI:', error.message);
  process.exit(1);
}

// Create MongoDB client with validated URI
let client;
try {
  client = new MongoClient(mongoURI, {
    connectTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    serverSelectionTimeoutMS: 60000,
    retryWrites: true,
    retryReads: true,
    maxPoolSize: 1,
    minPoolSize: 1,
    writeConcern: { w: 'majority' }
  });
  console.log('MongoDB client created successfully');
} catch (error) {
  console.error('Error creating MongoDB client:', error);
  process.exit(1);
}

let db;

const config = {
    port: process.env.PORT || 3000,
    hyperliquidApiUrl: process.env.HYPERLIQUID_API_URL,
    hypurrscanApiUrl: process.env.HYPURRSCAN_API_URL,
    corsOrigin: process.env.CORS_ORIGIN,
    pollingInterval: parseInt(process.env.POLLING_INTERVAL, 10) || 60000,
    jwtSecret: process.env.JWT_SECRET || (() => {
        console.error('WARNING: JWT_SECRET is not set. Using an insecure default secret.');
        return 'your_jwt_secret';
    })(),
};

// Add this check at app startup
if (!process.env.JWT_SECRET) {
    console.error('⚠️  WARNING: JWT_SECRET environment variable is not set!');
    console.error('Please configure JWT_SECRET in your Vercel environment variables.');
    
    if (process.env.NODE_ENV === 'production') {
        console.error('Refusing to start in production without JWT_SECRET');
        process.exit(1);
    }
}

const limit = pLimit(5);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
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

const getSpotMeta = () => makeRateLimitedRequest(async () => {
    const response = await axios.post(config.hyperliquidApiUrl, { type: "spotMeta" });
    if (!response.data?.tokens) throw new Error('Invalid API response for spotMeta.');
    return response.data.tokens.map(token => ({
        name: token.name,
        tokenId: token.tokenId,
        index: token.index
    }));
}, 20);

const getAllDeploys = () => makeRateLimitedRequest(async () => {
    const response = await axios.get(config.hypurrscanApiUrl);
    return response.data;
}, 20);

const getTokenDetails = (tokenId) => makeRateLimitedRequest(async () => {
    const response = await axios.post(config.hyperliquidApiUrl, { type: "tokenDetails", tokenId });
    if (!response.data?.name) throw new Error(`Details not found for tokenId: ${tokenId}`);
    return response.data;
}, 20);

async function updateTokenData() {
    try {
        const currentData = await db.collection('allTokens').find({}).toArray();
        const startPxData = await db.collection('startPx').find({}).toArray();
        const [spotTokens, deploys] = await Promise.all([getSpotMeta(), getAllDeploys()]);
        let hasChanges = false;

        for (const token of spotTokens) {
            const existingToken = currentData.find(t => t.tokenIndex === token.index);

            try {
                const details = await getTokenDetails(token.tokenId);
                const startPxEntry = startPxData.find(t => t.index === token.index);
                const startPx = startPxEntry?.startPx || null;

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
                    airdrop1: existingToken?.airdrop1 || null,
                    airdrop2: existingToken?.airdrop2 || null,
                    devReputation: existingToken?.devReputation || false,
                    spreadLessThanThree: existingToken?.spreadLessThanThree || false,
                    thickObLiquidity: existingToken?.thickObLiquidity || false,
                    noSellPressure: existingToken?.noSellPressure || false,
                    twitter: existingToken?.twitter || "",
                    telegram: existingToken?.telegram || "",
                    discord: existingToken?.discord || "",
                    website: existingToken?.website || "",
                    projectDescription: existingToken?.projectDescription || "",
                    personalComment: existingToken?.personalComment || "",
                    devTeamContact: existingToken?.devTeamContact || "",
                    lastUpdated: new Date().toISOString()
                };

                if (!existingToken) {
                    console.log(`New token found: ${token.name}`);
                    console.log('Inserting new token data:', tokenData);
                    const insertResult = await db.collection('allTokens').insertOne(tokenData);
                    console.log('Insert result:', insertResult);
                    hasChanges = true;
                } else {
                    console.log('Updating existing token data:', tokenData);
                    const updateResult = await db.collection('allTokens').findOneAndUpdate(
                        { tokenIndex: token.index },
                        { $set: tokenData },
                        { returnDocument: 'after' }
                    );
                    console.log('Update result:', updateResult.value);
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

const app = express();

// Configuration CORS avec support complet des credentials
const corsOptions = {
    origin: ['https://www.hypurrspot.xyz', 'https://backend-finalllll.vercel.app'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie'],
    exposedHeaders: ['Set-Cookie'],
    preflightContinue: false,
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.use(cookieParser());

// Configuration des cookies
const COOKIE_CONFIG = {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    domain: process.env.NODE_ENV === 'production' ? '.vercel.app' : undefined
};

app.use((req, res, next) => {
    res.cookie = res.cookie.bind(res);
    const oldCookie = res.cookie;
    res.cookie = function (name, value, options = {}) {
        return oldCookie.call(this, name, value, {
            ...options,
            sameSite: 'none',
            secure: true,
            httpOnly: true,
            path: '/',
            domain: '.vercel.app'
        });
    };
    next();
});

// Middleware pour les headers CORS additionnels
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Origin', 'https://www.hypurrspot.xyz');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

app.use(express.json());
app.use(cookieParser());

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

// Créer une fonction pour initialiser la connexion à la base de données
async function initializeDatabase(retryCount = 0) {
    const maxRetries = 3;
    const retryDelay = 2000;

    try {
        console.log(`Attempting to connect to MongoDB (attempt ${retryCount + 1}/${maxRetries + 1})...`);
        
        // Force close any existing connection
        try {
            await client.close(true);
        } catch (e) {
            console.log('No existing connection to close');
        }
        
        // Clear the db reference
        db = null;
        
        // Connect with new options
        await client.connect();
        
        // Explicitly select the database
        db = client.db('backendHL');
        
        // Test the connection and authentication
        await db.command({ ping: 1 });
        console.log('Successfully connected to MongoDB');
        
        return true;
    } catch (error) {
        console.error('MongoDB connection error:', error);
        console.error('Connection URI (sanitized):', process.env.MONGO_URI?.replace(/:[^:@]*@/, ':****@'));
        
        if (retryCount < maxRetries) {
            console.log(`Retrying in ${retryDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return initializeDatabase(retryCount + 1);
        }
        
        return false;
    }
}

// Middleware pour vérifier la connexion à la base de données
const checkDatabaseConnection = async (req, res, next) => {
    if (!db) {
        try {
            const connected = await initializeDatabase();
            if (!connected) {
                return res.status(500).json({ error: 'Database connection failed' });
            }
        } catch (error) {
            console.error('Error during database connection check:', error);
            return res.status(500).json({ error: 'Database connection failed' });
        }
    }
    next();
};

// Middleware pour extraire et valider le token JWT
const extractToken = (req) => {
    if (req.cookies && req.cookies.token) {
        return req.cookies.token;
    }
    
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }

    // Add query parameter check as fallback
    if (req.query && req.query.token) {
        return req.query.token;
    }

    return null;
};

// Middleware d'authentification amélioré
const authenticateAdmin = async (req, res, next) => {
    try {
        const token = extractToken(req);
        
        if (!token) {
            return res.status(401).json({
                error: 'Authentication required',
                message: 'No token provided'
            });
        }

        try {
            const decoded = jwt.verify(token, config.jwtSecret);
            
            // Vérification de l'expiration
            if (decoded.exp && Date.now() >= decoded.exp * 1000) {
                res.clearCookie('token');
                return res.status(401).json({
                    error: 'Token expired',
                    message: 'Please login again'
                });
            }

            // Vérification du rôle admin
            if (decoded.username !== 'admin') {
                return res.status(403).json({
                    error: 'Insufficient permissions',
                    message: 'Admin access required'
                });
            }

            // Stockage des informations de l'utilisateur pour utilisation ultérieure
            req.user = decoded;
            next();
            
        } catch (error) {
            if (error.name === 'JsonWebTokenError') {
                return res.status(401).json({
                    error: 'Invalid token',
                    message: 'Token validation failed'
                });
            }
            if (error.name === 'TokenExpiredError') {
                res.clearCookie('token');
                return res.status(401).json({
                    error: 'Token expired',
                    message: 'Please login again'
                });
            }
            throw error;
        }
    } catch (error) {
        console.error('Authentication error:', error);
        return res.status(500).json({
            error: 'Authentication failed',
            message: 'Internal server error during authentication'
        });
    }
};

// Constants for token configuration
const TOKEN_CONFIG = {
    accessTokenExpiry: '24h',
    cookieMaxAge: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    cookieOptions: {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        domain: '.vercel.app'
    }
};

// Middleware to handle token validation and refresh
const validateToken = (req, res, next) => {
    const token = extractToken(req);
    
    if (!token) {
        return res.status(401).json({
            error: 'No token provided',
            code: 'TOKEN_MISSING'
        });
    }

    try {
        const decoded = jwt.verify(token, config.jwtSecret);
        req.user = decoded;

        // Check if token needs refresh (less than 30 minutes remaining)
        const timeRemaining = decoded.exp - Math.floor(Date.now() / 1000);
        if (timeRemaining < 1800) { // 30 minutes in seconds
            const newToken = jwt.sign(
                { username: decoded.username, role: decoded.role },
                config.jwtSecret,
                { expiresIn: TOKEN_CONFIG.accessTokenExpiry }
            );

            res.cookie('token', newToken, TOKEN_CONFIG.cookieOptions);
        }

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            res.clearCookie('token', TOKEN_CONFIG.cookieOptions);
            return res.status(401).json({
                error: 'Token expired',
                code: 'TOKEN_EXPIRED'
            });
        }
        
        return res.status(401).json({
            error: 'Invalid token',
            code: 'TOKEN_INVALID'
        });
    }
};

app.use(checkDatabaseConnection);

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await db.collection('users').findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({
            username: user.username,
            role: 'admin',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 heures
        }, config.jwtSecret);

        res.cookie('token', token, COOKIE_CONFIG);
        res.setHeader('Authorization', `Bearer ${token}`);

        res.json({
            success: true,
            username: user.username,
            token
        });

        console.log('Login successful, token set in cookie and response');
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/tokens', async (req, res) => {
    try {
        console.log('Checking database connection...');
        if (!db) {
            console.error('Database connection not established');
            return res.status(500).json({ error: 'Database connection not established' });
        }

        console.log('Fetching token data from database...');
        const collection = db.collection('allTokens');
        if (!collection) {
            console.error('Collection not found');
            return res.status(500).json({ error: 'Collection not found' });
        }

        const data = await collection.find({}).toArray();
        console.log(`Found ${data.length} tokens`);
        
        if (!data || data.length === 0) {
            console.log('No tokens found in database');
            return res.json([]);
        }

        console.log('Token data fetched successfully');
        res.json(data);
    } catch (error) {
        console.error('Detailed error:', error);
        res.status(500).json({ 
            error: 'Error reading token data',
            details: error.message,
            stack: error.stack
        });
    }
});

app.put('/api/tokens/:tokenIndex', validateToken, authenticateAdmin, async (req, res) => {
    try {
        const tokenIndex = parseInt(req.params.tokenIndex, 10);
        if (isNaN(tokenIndex)) {
            return res.status(400).json({ error: 'Invalid token index' });
        }

        const updates = {
            ...req.body,
            lastUpdated: new Date().toISOString()
        };

        // Validate the updates
        if (updates.projectDescription && updates.projectDescription.length > 1000) {
            return res.status(400).json({ error: 'Project description too long' });
        }
        if (updates.personalComment && updates.personalComment.length > 500) {
            return res.status(400).json({ error: 'Personal comment too long' });
        }

        const result = await db.collection('allTokens').findOneAndUpdate(
            { tokenIndex: tokenIndex },
            { $set: updates },
            { returnDocument: 'after' }
        );

        if (!result.value) {
            return res.status(404).json({ error: 'Token not found' });
        }

        res.json({
            message: 'Token updated successfully',
            token: result.value
        });

    } catch (error) {
        console.error('Error updating token:', error);
        res.status(500).json({
            error: 'Error updating token data',
            details: error.message
        });
    }
});

app.put('/api/tokens/:tokenIndex/highlight', validateToken, authenticateAdmin, async (req, res) => {
    try {
        const tokenIndex = parseInt(req.params.tokenIndex, 10);
        const { highlight } = req.body;

        const result = await db.collection('allTokens').findOneAndUpdate(
            { tokenIndex: tokenIndex },
            { $set: { highlighted: highlight } },
            { returnDocument: 'after' }
        );

        if (!result.value) {
            return res.status(404).json({ error: 'Token not found' });
        }

        res.json({ success: true, token: result.value });
    } catch (error) {
        console.error('Error updating highlight:', error);
        res.status(500).json({ error: 'Error updating highlight' });
    }
});

app.post('/api/update', async (req, res) => {
    try {
        console.log('Scheduled update triggered');
        await updateTokenData(); // Appelle votre logique de mise à jourRRRaR
        res.status(200).send('Update completed');
    } catch (error) {
        console.error('Error during scheduled update:', error);
        res.status(500).send('Update failed');
    }
});

app.get('/api/check-auth', validateToken, (req, res) => {
    res.header('Access-Control-Allow-Origin', 'https://www.hypurrspot.xyz');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.json({
        authenticated: true,
        user: {
            username: req.user.username,
            role: req.user.role,
            exp: req.user.exp
        }
    });
});

app.post('/api/logout', validateToken, (req, res) => {
    res.clearCookie('token', TOKEN_CONFIG.cookieOptions);
    console.log(`User ${req.user.username} logged out at ${new Date().toISOString()}`);
    res.json({ success: true });
});

// Exporter l'application avant d'établir la connexion de ramia
module.exports = app;

// Modifier le démarrage du serveur
if (require.main === module) {
    initializeDatabase().then(connected => {
        if (connected) {
            app.listen(config.port, () => {
                console.log(`Server running on port ${config.port}`);
                updateTokenData().then(() => {
                    cron.schedule('* * * * *', updateTokenData);
                });
            });
        } else {
            process.exit(1);
        }
    });
}

// Ensure the app is exported for Vercel
module.exports = app;