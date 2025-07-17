const { generateGeminiResponse } = require('../config/geminiClient');
const { generateCohereResponse } = require('../config/cohereClient');
const logger = require('../services/logger');
const sharedContext = require('../sharedContext');

// Utility to deduplicate array (case-insensitive)
const dedupe = arr => [...new Set(arr.map(i => i.trim().toLowerCase()))];

// 🚀 Build the prompt to instruct Gemini to classify the query
function buildPrompt(userQuery) {
  const selected = sharedContext.selectedFieldsPerObject || {};
  const fieldDescriptions=sharedContext.selectedFieldDescriptions||[]
 
  

  console.log("selected", selected);
  console.log("Field Description",fieldDescriptions)


  return `
You are a structured query assistant.

Your task is to convert the user's natural language query into a JSON object representing a Mongo-style "where" clause for metadata filtering.

All fields are flat and may include prefixes like "employee_", "leaves_", etc., to indicate their source object. There is no nested structure.


Only use the fields listed below:
${JSON.stringify(selected)}

Use the following field descriptions to understand each field's meaning:
${JSON.stringify(fieldDescriptions)}

User Query:
"${userQuery}"

Rules:
1. Use only the selected fields to build the where clause. Do not invent fields.
2. Match values in the user query to fields based only on the descriptions.
3. If a value could match more than one field, use an $or clause.
4. If the query specifies multiple conditions, combine them with $and.
5. If the user query contains a word that clearly refers to an object (e.g., "in staff object", "from employee", "within leave record"), you must:

   a. Identify the object name mentioned (e.g., "staff").
   
   b. Filter metadata fields so that **only fields whose names start with this object name followed by an underscore** (e.g., "staff_") are considered for mapping.

   c. Even if other field descriptions semantically match, they must be **excluded** if their prefix doesn't match the mentioned object.

   d. This rule takes strict priority over semantic similarity.
6. Use these operators:
   - "$eq" for exact matches
   - "$lt", "$lte", "$gt", "$gte" for comparisons
  -If a value refers to a number , convert it into a **numeric type**. Do not wrap numeric values in quotes.
7. Normalize all values in the where clause to lowercase strings.
8. Do not include "objectname" or any extra keys.
9. Return the final result in this JSON format:

{
  "originalQuery": "exact user query",
  "where": { ... },
  "layer": true | false
}

Set "layer" to true if answering requires data across multiple object prefixes, otherwise false.

Output only the JSON. Do not include markdown, explanations, or extra formatting.
  `.trim();

}


// Main function to classify the query using Gemini
async function objectclassifyQuery(userQuery) {
  const select_modal= sharedContext.select_modal || '';
    console.log("selected_modal",select_modal);
  try {
    const prompt = buildPrompt(userQuery);
    console.log("prompt",prompt);
    
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
