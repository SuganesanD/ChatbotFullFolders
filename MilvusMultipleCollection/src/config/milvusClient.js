// src/config/milvusClient.js
require('dotenv').config(); // Load environment variables from .env

// Import MilvusClient and DataType from the SDK
const { MilvusClient, DataType } = require('@zilliz/milvus2-sdk-node');

// Retrieve Milvus connection details from environment variables
const milvusAddress = process.env.MILVUS_ADDRESS;
// MILVUS_TOKEN is optional. If it's not set in .env or is an empty string,
// process.env.MILVUS_TOKEN will be undefined or an empty string, respectively.
const milvusToken = process.env.MILVUS_TOKEN;

// Basic validation to ensure MILVUS_ADDRESS is provided
if (!milvusAddress) {
    throw new Error("MILVUS_ADDRESS environment variable is not set in .env. Please check your .env file.");
}

// Initialize Milvus client.
// The 'token' property in the options object is only included if milvusToken is a non-empty string.
// This ensures that for unauthenticated setups (like your Docker one), no token is sent.
const milvusClient = new MilvusClient(
    milvusAddress,
milvusToken ? { token: milvusToken } : undefined // Pass token only if it exists and is not empty
);

// Export the initialized client and DataType enum for use in other modules
module.exports = { milvusClient, DataType };
