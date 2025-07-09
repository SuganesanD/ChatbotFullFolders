// handlers/handleGeneral.js

const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config({ path: './couchdb_credentials.env' });

const genAI = new GoogleGenerativeAI('AIzaSyD4zXj3LQtUGxPRbAwxkVM4lzZpQE6urOk');


async function handleGeneral(queryclassifier) {
  const userQuery=queryclassifier.originalQuery
  // const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  // const prompt = `${userQuery}`;

  // const result = await model.generateContent(prompt);
  // const response = result.response.text();
  

  // ✂️ Clean triple-backtick code block and parse JSON
  

  try {
    return userQuery;
    
  } catch (err) {
    console.error('❌ Failed to generate response for the user query:', err.message);
  }
}

  module.exports = handleGeneral;
  