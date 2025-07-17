// chromaClient.js
// services/chromaClient.js

const { ChromaClient } = require('chromadb');

const chroma = new ChromaClient({
  path: 'http://127.0.0.1:8000', // Or change this if your Chroma server runs elsewhere
});

module.exports = chroma;
