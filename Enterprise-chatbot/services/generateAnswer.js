// services/generateAnswer.js

const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

/**
 * Format context for readable input to the LLM
 * @param {Array|Object} context
 * @returns {string}
 */
function formatContext(context) {

  console.log("context:",context);
  
  if (!context) return 'No context available.';

  if (Array.isArray(context)) {
    return context
      .map((item, index) => `Item ${index + 1}:\n${JSON.stringify(item, null, 2)}`)
      .join('\n\n');
  }

  return JSON.stringify(context, null, 2);
}

/**
 * Generate a precise answer using Gemini based on query, context, and classified structure
 * @param {Array|Object} context - Retrieved knowledge
 * @param {string} query - Original user question
 * @param {Object} classified - Structured JSON intent from classifyQuery
 * @returns {Promise<string>} - Final answer for frontend
 */
async function generateAnswer(context, query, classified) {
  try {
    const readableContext = formatContext(context);
    console.log("readablecontext:",readableContext);  
    
   const prompt = `
You are an intelligent assistant for an enterprise HR team. Your job is to answer employee-related queries accurately and politely.

Here is the context retrieved from the database or internal logic:
-------------------
${readableContext}
-------------------

Here is the classified intent:
${JSON.stringify(classified, null, 2)}

Here is the user's original question:
"${query}"

Answer clearly using only the context above for all the category in the classified intent except "General".
If the classified intent count is "true" then use the number in the readableContext to answer the query.
IF the classified intent category is "General", do NOT use the context; instead, answer in a general manner relevant to employee queries.
IF the context doesn't have enough information to answer (and the intent is NOT "General"), say:
"I don’t have enough information to answer that right now."

Do not hallucinate or assume anything beyond the context for non-general queries and do not leave any context.
`;

    logger.info("📨 Sending prompt to Gemini...");
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const response = result.response;
    const answer = response.text().trim();

    console.log(`🤖 Generated Answer:${answer}`);
    

    logger.info("✅ Gemini Answer Generated");
    return answer;

  } catch (err) {
    logger.error(`❌ Error in generateAnswer: ${err.message}`);
    return "Sorry, I couldn’t generate an answer due to a technical issue.";
  }
}

module.exports = {generateAnswer};
