const { generateGeminiResponse } = require('../config/geminiClient');
const { generateCohereResponse } = require('../config/cohereClient');
const logger = require('../services/logger');
const sharedContext = require('../sharedContext');

// Utility to deduplicate array (case-insensitive)
const dedupe = arr => [...new Set(arr.map(i => i.trim().toLowerCase()))];

// 🚀 Build the prompt to instruct Gemini to classify the query
function buildPrompt(userQuery) {
  const selected = sharedContext.selectedFieldsPerObject || {};
  const available = sharedContext.availableFieldsPerObject || {};
  const objectList = sharedContext.objectList || [];
  

  console.log("selected", selected);
  console.log("available", available);
  console.log("objectlist", objectList);


  return `
You are an AI query classifier that converts user queries into structured JSON for a hybrid metadata + vector search system.

Your task is to:

Identify user intent.

Extract values that match selected metadata fields.

Enforce object targeting logic.

Build a valid JSON containing:

- "originalQuery": the raw user query
- "where": a flat Mongo-style filter using only the selected metadata fields
- "layer": true if the fields needed to answer are not in the same object used to identify the user

📆 Output Format (STRICT):
{
"originalQuery": "...",
"where": { ... },
"layer": true | false
}

🔍 OBJECT TYPES:
${objectList.join(', ')}

📌 Selected Metadata Fields (ONLY fields allowed in "where"):
${Object.entries(selected)
  .map(([obj, fields]) => `- ${obj}: ${dedupe(fields).join(', ')}`)
  .join('\n')}

📌 Available Fields (used ONLY for evaluating "layer", NOT filtering):
${Object.entries(available)
  .map(([obj, fields]) => `- ${obj}: ${dedupe(fields).join(', ')}`)
  .join('\n')}

🧠 CLASSIFICATION LOGIC:

✅ 1. Use only **selected metadata fields** to construct the "where" clause.

✅ 2. Normalize all string values in "where" to lowercase.

✅ 3. Apply the correct Mongo-style operator:
- '$lt'  for “less than” (e.g., “salary less than 50000”)
- '$lte'  for “less than or equal to”
- '$gt'  for “greater than”
- '$eq' for exact matches (e.g., “salary is 20000”)
- '$gte'  for “greater than or equal to”

✅ 4. Match values to field names:
- One match: { "field": { "$operator": "value" } }
- Multiple fields match a value: use $or
- Multiple unrelated conditions: use $and 

✅ 5. If the query references a specific word that is giving addtional information about where to search then use that word to form the "objectname" while forming "where"


✅ 6. Set "layer": true if:

The answer requires fields not available in the object used to identify the user

Or, the answer logically comes from a different object

✅ 7. Set "layer": false only when all relevant filter and answer fields are available in the same object

8. If the is a word meaning like object in the query ,check if that word is present in the objectlist,if not present then use that particular word in the "objectname" field while creating "where" 

🚫 DO NOT:

❌ Use or return "whereDocument"

❌ Include unlisted or invented fields in "where"

❌ Nest filters under object names if it is not present in the objectlist

❌ Assume values — only use what's present in the query

❌ Apply any filter unless it's based on the selected metadata fields


Now classify this query:
"${userQuery}" `


}


// Main function to classify the query using Gemini
async function objectclassifyQuery(userQuery) {
  const select_modal= sharedContext.select_modal || '';
    console.log("selected_modal",select_modal);
  try {
    const prompt = buildPrompt(userQuery);
    let response=''
    if(select_modal=='gemini'){
       response = await generateGeminiResponse(prompt);
    }
    else if (select_modal=='cohere'){
      response= await generateCohereResponse(prompt);
    }
    

    // Extract JSON part from Gemini response
    const jsonStart = response.indexOf('{');
    const jsonEnd = response.lastIndexOf('}');
    const jsonString = response.slice(jsonStart, jsonEnd + 1);

    let parsed = {};
    try {
      parsed = JSON.parse(jsonString);
    } catch (err) {
      logger.error('❌ Gemini returned invalid JSON:\n' + response);
      return {
        originalQuery: userQuery,
        where: {},
        layer: false
      };
    }

    // Fallback values for safety
    parsed.originalQuery = parsed.originalQuery || userQuery;
    parsed.where = parsed.where || {};
    parsed.layer = parsed.layer ?? false;

    logger.info('✅ Classified JSON:', parsed);
    return parsed;

  } catch (error) {
    logger.error('❌ Error in objectclassifyQuery:', error);
    return {
      originalQuery: userQuery,
      where: {},
      layer: false
    };
  }
}

module.exports = { objectclassifyQuery };
