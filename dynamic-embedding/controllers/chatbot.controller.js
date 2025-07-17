// controllers/chatbot.controller.js

const {generateAnswer} = require('../services/generateAnswer');
const logger = require('../services/logger');
const { objectclassifyQuery } = require('../services/objectclassifyQuery');
const { fetchEmbeddingsAndQuery } = require('../handlers/fetchEmbeddingsAndQuery');


// Full RAG pipeline handler
const askHandler = async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid query' });
    }

    logger.info(`💬 Incoming Query: ${query}`);

      
      // 1. Classify the query into structured JSON
    const classified = await objectclassifyQuery(query);
    logger.info(`✅ Classified JSON: ${JSON.stringify(classified)}`);

    

    // 3. Route to appropriate logic function (fetch from vector db, filters, etc.)
    const { data, context } = await fetchEmbeddingsAndQuery(classified);
    logger.info(`📥 Retrieved Context: ${context?.length || data?.length || 0} items`);

    // 4. Generate clean final answer using LLM
    const answer = await generateAnswer(context, query);

    // 5. Return to frontend
    return res.status(200).json({
      query,
      classified,
      answer,
      rawData: data,
    });

  } catch (err) {
    logger.error('❌ askHandler Error:', err);
    return res.status(500).json({ error: 'Something went wrong in /ask' });
  }
};

module.exports = {
  askHandler,
};
