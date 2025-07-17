// services/generateAnswer.js

const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');
require('dotenv').config({path:'./couchdb_credentials.env'})


const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

/**
 * Format context for readable input to the LLM
 * Removes backticks and provides clean natural language input
 * @param {Array|Object} context
 * @returns {string}
 */
function formatContext(context) {
  if (!context || context.length === 0) return 'No context available.';

  return context
    .map((item, i) => {
      const text = typeof item === 'string' ? item.trim() : JSON.stringify(item);
      const clean = text.replace(/^`+|`+$/g, '').trim();
      return `Paragraph ${i + 1}:\n${clean}`;
    })
    .join('\n\n');
}

/**
 * Generate a precise answer using Gemini based on query, context, and classified structure
 * @param {Array|Object} context - Retrieved knowledge
 * @param {string} query - Original user question
 * @param {Object} classified - Structured JSON intent from classifyQuery
 * @returns {Promise<string>} - Final answer for frontend
 */
async function generateAnswer(context, query) {
  return new Promise(async(resolve, reject) => {
    try {
      const readableContext = formatContext(context);
      console.log("📥 Readable Context:\n", readableContext);
  
      const prompt = `
  You are a highly reliable AI assistant for an enterprise HR system. Your task is to answer user queries strictly using the provided context below.
  
  📚 CONTEXT:
  The following text chunks contain factual information retrieved from the HR database. They include details about employees, additional info, and leave records.
  
  ---------------
  ${readableContext}
  ---------------
  
  📨 USER QUERY:
  "${query}"
  
  🎯 INSTRUCTIONS:
  
  - Use only the context chunks above to answer the question.
  - Carefully match records with the given context only.
  - If the required fields are not there ,then try to answer with the values in the context by infering only from the context.
  - If a name (e.g., "derick") appears in one chunk and related data (e.g., leave dates) is in another, you MUST connect them based on identifiers like employee ID or clear name matches.
  - DO NOT make up answers that are not present in the context.
  - DO NOT use world knowledge or assumptions beyond the context.
  - For the user question ,Infer only from the context that is given and look for meaning that are accurately related.
  - If there is no context related to user question, then try to answer with the context that is given to match the user question.
  - If the context does not contain enough information to answer the query accurately, reply with:
    "Sorry!I could not able to answer,can you reframe your question?"
  - Always be concise and professional in your reply.
  `;
  
  
      logger.info("📨 Sending prompt to Gemini...",genAI);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(prompt);
      const response = result.response;
      const answer = response.text().trim();
  
      logger.info("✅ Gemini Answer Generated");
      console.log(`🤖 Generated Answer: ${answer}`);
  
      resolve(answer) ;
  
    } catch (err) {
      logger.error(`❌ Error in generateAnswer: ${err.message}`);
      reject( "Sorry, I couldn’t generate an answer due to a technical issue.");
    }
  })
}

module.exports = { generateAnswer };
