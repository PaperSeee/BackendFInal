// src/config/database.js
const { MongoClient } = require('mongodb');
require('dotenv').config();

if (!process.env.MONGO_URI || process.env.MONGO_URI.trim() === '') {
  console.error('MONGO_URI must be defined in your .env file');
  process.exit(1);
}

const mongoURI = process.env.MONGO_URI;

const client = new MongoClient(mongoURI, {
  connectTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 60000,
  retryWrites: true,
  retryReads: true,
  maxPoolSize: 10,
  minPoolSize: 1,
  writeConcern: { w: 'majority' }
});

async function connectToDatabase() {
  if (!client.isConnected?.()) {
    await client.connect();
    console.log('Connected to MongoDB');
  }
  return client.db('backendHL');
}

module.exports = { connectToDatabase, client };
