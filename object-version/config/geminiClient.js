// config/geminiClient.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: './couchdb_credentials.env' });
// Load GEMINI_API_KEY from .env

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Use Gemini 1.5 Flash for cost-efficiency and speed
const model = genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash' });

/**
 * Sends a classification prompt to Gemini and returns the text response.
 * @param {string} prompt - Structured prompt for classification.
 * @returns {Promise<string>} - LLM response text.
 */
async function generateGeminiResponse(prompt) {
  try {
    const result = await model.generateContent(prompt);
    const response =  result.response;
    const text = response.text();

    return text;
  } catch (err) {
    console.error("❌ Error generating Gemini response:", err);
    throw new Error("Gemini API failed");
  }
}

module.exports = { generateGeminiResponse };

