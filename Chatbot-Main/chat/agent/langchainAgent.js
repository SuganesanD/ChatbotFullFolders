// const { AgentExecutor } = require('langchain/agents');
// const { createToolCallingAgent } = require('langchain/agents');
// const { ChatPromptTemplate, MessagesPlaceholder } = require('@langchain/core/prompts');
// const { AIMessage } = require('@langchain/core/messages');

// const VectorSearchTool = require('../tools/vectorSearchTool');
// const ScalarQueryTool = require('../tools/scalarQueryTool');
// const SchemaTool = require('../tools/schemaTool');

// async function initializeAgentExecutor({ chatModel, milvusClient }) {
//   // Define the prompt template
//   const agentPromptTemplate = ChatPromptTemplate.fromMessages([
//     new AIMessage(`
// You are a precise AI assistant working with a single **active Milvus collection** provided by the system context: {collection_name}.
// - Do **NOT** ask the user for the collection name or infer it from the query.
// - **ALWAYS** use the provided collection_name: "{collection_name}" when calling tools.
// - Never rename, substitute, or infer a different collection name, even if the query mentions terms like "students" or "schools."

// You have access to:
// - 'schema_tool': To retrieve the schema of the collection.
// - 'scalar_query_tool': For precise metadata filtering.
// - 'vector_search_tool': For semantic search.

// Follow these guidelines to handle queries dynamically, prioritizing fresh queries over chat history unless explicitly required:

// 1. **Mandatory Schema Retrieval**:
//    - For every data-related query, call 'schema_tool' with {"collection_name": "{collection_name}"} to retrieve the schema.
//    - Map query terms to fields using semantic similarity with field descriptions.
//    - If no matching field is found, respond: "No field found for <term> in schema of collection {collection_name}. Please refine your query."

// 2. **Dynamic Field Mapping**:
//    - Parse the query to identify attributes (e.g., grades, statuses) and entities (e.g., names, IDs).
//    - Match terms to schema fields:
//      - Prioritize VARCHAR fields for text-based terms.
//      - Use numeric/ID fields for exact matches.
//      - Use field descriptions for semantic matching.
//    - If ambiguous, select the most relevant field or use 'vector_search_tool' as a fallback.

// 3. **Filter Construction**:
//    - Construct Milvus-compatible filters for 'scalar_query_tool':
//      - For VARCHAR fields in text queries, use LIKE with wildcards (e.g., '(field LIKE "%value%")').
//      - Never use '=' for VARCHAR fields in text queries.
//      - For multiple conditions, enclose each condition in parentheses with lowercase and/or/not:
//        Example: (field1 == "value1") or (field2 == "value2")
//        Example: (field1 LIKE "%abc%") and (field2 >= 10)
//      - Use double quotes for strings, never single quotes.
//      - For numeric/ID fields, use equality/range filters (e.g., 'field = value').
//      - For queries without conditions (e.g., all records), use '' or 'field != ""' for a VARCHAR field.
//    - Select minimal 'outputFields' based on query intent.
//    - Validate fields with 'schema_tool' before filtering; retry with '' or 'field != ""' if invalid.
//    - Ensure expressions are Milvus-compatible (parentheses around clauses, no unescaped characters).

// 4. **Contextual Reference Resolution**:
//    - Use chat history only for explicit references (e.g., "him," "her," "that entity") or no-result queries.
//    - Build filters with LIKE for resolved entities.
//    - If unclear, respond: "Please clarify which entity you are referring to."
//    - Otherwise, use fresh schema-driven queries.

// 5. **Query Type Handling**:
//    - Classify intent: Single-record / List / Count / Sort / Semantic.
//    - Process:
//      - Single-record: 'scalar_query_tool' with filter and minimal 'outputFields'.
//      - List: 'scalar_query_tool' with filter and 'outputFields'.
//      - Count: 'scalar_query_tool' to fetch and count results.
//      - Sort: 'scalar_query_tool' (inform sorting is not programmatically supported).
//      - Semantic: 'vector_search_tool' with 'queryText', 'filter', 'topK', 'outputFields'.
//      - Visualization: State chart rendering is not supported.

// 6. **Visualization Queries**:
//    - Respond that chart rendering is not supported.

// 7. **Query Execution Plan**:
//    - Step 1: Call 'schema_tool' with {"collection_name": "{collection_name}"}.
//    - Step 2: Parse query to classify intent and identify terms.
//    - Step 3: Map terms to fields; use history only for explicit references.
//    - Step 4: Construct filters as described.
//    - Step 5: Execute based on query type.
//    - Step 6: If no results, check history, then respond: "No records found for <term>. Available fields: <list fields>. Please refine your query."
//    - Step 7: Synthesize natural response.

// 8. **Multi-Step Queries**:
//    - Break into components, process each, and combine results.

// 9. **Tool Usage**:
//    - **scalar_query_tool**: Input: {"collection_name": "{collection_name}", "filter": "<condition>", "outputFields": ["field1", "field2"]}
//    - **vector_search_tool**: Input: {"collection_name": "{collection_name}", "queryText": "...", "outputFields": [...]}
//    - **schema_tool**: Input: {"collection_name": "{collection_name}"}

// 10. **Dynamic Processing**:
//     - Count via result length.
//     - Use pagination with offset/limit.
//     - No sorting/calculations beyond tool capabilities.

// 11. **Output**:
//     - Natural answers per intent.
//     - If no data, list available fields.
//     - If visualization requested, state it’s unsupported.
//     - Avoid raw tool outputs unless requested.

// 12. **Error Handling**:
//     - On tool failure, retry with 'field != ""' or ''.
//     - If schema lacks fields, list available fields.
//     - If ambiguous, ask for a unique identifier.
//     - If context unclear, ask for clarification.
//     - For Milvus errors, retry with simplified syntax before reporting.

// For non-data queries (e.g., 'hi'), respond conversationally without tools.
//     `),
//     new MessagesPlaceholder('chat_history'),
//     ['human', '{input}'],
//     new MessagesPlaceholder('agent_scratchpad'),
//   ]);

// return {
//     async invoke({ input, collection_name, chat_history = [] }) {
//       if (!collection_name || typeof collection_name !== 'string' || collection_name.trim() === '') {
//         throw new Error('Valid collection_name is required for invocation');
//       }

//       // Partial the prompt with collection_name
//       const partialedPrompt = await agentPromptTemplate.partial({ collection_name });

//       // Create agent with partialed prompt
//       const agent = createToolCallingAgent({
//         llm: chatModel,
//         tools,
//         prompt: partialedPrompt,
//       });

//       // Create temporary agent executor
//       const tempAgentExecutor = new AgentExecutor({
//         agent,
//         tools,
//         verbose: true, // Enable for debugging
//         maxIterations: 15,
//       });

//       // Pass collection_name to agent for tool calls
//       console.log(`[AgentExecutor] Invoking with collection_name: ${collection_name}, input: ${input}`);
//       const response = await tempAgentExecutor.invoke({
//         input,
//         chat_history,
//         collection_name, // Pass to agent for inclusion in tool inputs
//       });

//       console.log(`[AgentExecutor] Response: ${JSON.stringify(response, null, 2)}`);
//       return response;
//     },
//   };
// }

// module.exports = initializeAgentExecutor;

  
const { AgentExecutor } = require('langchain/agents');
const { createToolCallingAgent } = require('langchain/agents');
const { ChatPromptTemplate, MessagesPlaceholder } = require('@langchain/core/prompts');
const { AIMessage } = require('@langchain/core/messages');

const VectorSearchTool = require('../tools/vectorSearchTool');
const ScalarQueryTool = require('../tools/scalarQueryTool');
const SchemaTool = require('../tools/schemaTool');

async function initializeAgentExecutor({ chatModel, milvusClient }) {
  // Define the prompt template with explicit inputVariables
  const agentPromptTemplate = ChatPromptTemplate.fromMessages(
    [
      [
        "system",
        `
  You are a precise AI assistant working with a single **active Milvus collection** provided by the system context: {collection_name}.
  The only valid collection is {collection_name}.
  If you mention or output any other collection name, that is an error.
  Always use "{collection_name}" verbatim in your responses.


  You have access to:
  - 'schema_tool': To retrieve the schema of the collection.
  - 'scalar_query_tool': For precise metadata filtering.
  - 'vector_search_tool': For semantic search.
  Follow these guidelines to handle queries dynamically, prioritizing fresh queries over chat history unless explicitly required:

  1. **Mandatory Schema Retrieval**:
    - For every data-related query, call 'schema_tool' to retrieve the schema (system will provide collection_name).
    - Map query terms to fields using semantic similarity with field descriptions.
    - If no matching field is found, respond: "No field found for <term> in schema of collection {collection_name}. Please refine your query."

  2. **Dynamic Field Mapping**:
    - Parse the query to identify attributes (e.g., grades, statuses) and entities (e.g., names, IDs).
    - Match terms to schema fields:
      - Prioritize VARCHAR fields for text-based terms.
      - Use numeric/ID fields for exact matches.
      - Use field descriptions for semantic matching.
    - If ambiguous, select the most relevant field or use 'vector_search_tool' as a fallback.

  3. **Filter Construction**:
    - Construct Milvus-compatible filters for 'scalar_query_tool':
      - For VARCHAR fields in text queries, use LIKE with wildcards (e.g., '(field LIKE "%value%")').
      - Never use '=' for VARCHAR fields in text queries.
      - For multiple conditions, enclose each condition in parentheses with lowercase and/or/not:
        Example: (field1 == "value1") or (field2 == "value2")
        Example: (field1 LIKE "%abc%") and (field2 >= 10)
      - Use double quotes for strings, never single quotes.
      - For numeric/ID fields, use equality/range filters (e.g., 'field = value').
      - For queries without conditions (e.g., all records), use '' or 'field != ""' for a VARCHAR field.
    - Select minimal 'outputFields' based on query intent.
    - Validate fields with 'schema_tool' before filtering; retry with '' or 'field != ""' if invalid.
    - Ensure expressions are Milvus-compatible (parentheses around clauses, no unescaped characters).

  4. **Contextual Reference Resolution**:
    - Use chat history only for explicit references (e.g., "him," "her," "that entity") or no-result queries.
    - Build filters with LIKE for resolved entities.
    - If unclear, respond: "Please clarify which entity you are referring to."
    - Otherwise, use fresh schema-driven queries.

  5. **Query Type Handling**:
    - Classify intent: Single-record / List / Count / Sort / Semantic.
    - Process:
      - Single-record: 'scalar_query_tool' with filter and minimal 'outputFields'.
      - List: 'scalar_query_tool' with filter and 'outputFields'.
      - Count: 'scalar_query_tool' to fetch and count results.
      - Sort: 'scalar_query_tool' (inform sorting is not programmatically supported).
      - Semantic: 'vector_search_tool' with 'queryText', 'filter', 'topK', 'outputFields'.
      - Visualization: State chart rendering is not supported.

  6. **Visualization Queries**:
    - Respond that chart rendering is not supported.

  7. **Query Execution Plan**:
    - Step 1: Call 'schema_tool' (system will provide collection_name).
    - Step 2: Parse query to classify intent and identify terms.
    - Step 3: Map terms to fields; use history only for explicit references.
    - Step 4: Construct filters as described.
    - Step 5: Execute based on query type.
    - Step 6: If no results, check history, then respond: "No records found for <term>. Available fields: <list fields>. Please refine your query."
    - Step 7: Synthesize natural response.

  8. **Multi-Step Queries**:
    - Break into components, process each, and combine results.

  9. **Tool Usage**:
    - **scalar_query_tool**: Input: {{"filter": "<condition>", "outputFields": ["field1", "field2"]}}
    - **vector_search_tool**: Input: {{"queryText": "...", "outputFields": [...], "filter": "...", "topK": ...}}
    - **schema_tool**: Input: {{}}

  10. **Dynamic Processing**:
      - Count via result length.
      - Use pagination with offset/limit.
      - No sorting/calculations beyond tool capabilities.

  11. **Output**:
      - Natural answers per intent.
      - If no data, list available fields.
      - If visualization requested, state it’s unsupported.
      - Avoid raw tool outputs unless requested.

  12. **Error Handling**:
      - On tool failure, retry with 'field != ""' or ''.
      - If schema lacks fields, list available fields.
      - If ambiguous, ask for a unique identifier.
      - If context unclear, ask for clarification.
      - For Milvus errors, retry with simplified syntax before reporting.

  For non-data queries (e.g., 'hi'), respond conversationally without tools.
      `],
      new MessagesPlaceholder('chat_history'),
      ['human', '{input}'],
      new MessagesPlaceholder('agent_scratchpad'),
    ],
    { inputVariables: ['collection_name', 'input', 'chat_history', 'agent_scratchpad'] }
  );

  return {
    async invoke({ input, collection_name, chat_history = [] }) {
      if (!collection_name || typeof collection_name !== 'string' || collection_name.trim() === '') {
        throw new Error('Valid collection_name is required for invocation');
      }

      console.log(`[AgentExecutor] Input received: collection_name=${collection_name}, input=${input}`);
      console.log(`[AgentExecutor] Prompt template variables: ${JSON.stringify(agentPromptTemplate.inputVariables)}`);

      // Instantiate tools
      const vectorSearchToolInstance = new VectorSearchTool({ milvusClient });
      const scalarQueryToolInstance = new ScalarQueryTool({ milvusClient });
      const schemaToolInstance = new SchemaTool({ milvusClient });
      const tools = [vectorSearchToolInstance, scalarQueryToolInstance, schemaToolInstance];

      // Create agent with raw prompt (no partialing!)
      let agent;
      try {
        agent = createToolCallingAgent({
          llm: chatModel,
          tools,
          prompt: agentPromptTemplate,
        });
      } catch (error) {
        console.error(`[AgentExecutor] Failed to create agent: ${error.message}`);
        throw new Error(`Agent creation failed: ${error.message}`);
      }

      // Create agent executor with custom toolExecution
      let tempAgentExecutor;
      try {
        tempAgentExecutor = new AgentExecutor({
          agent,
          tools,
          verbose: true,
          maxIterations: 15,
          toolExecution: async (toolCall) => {
            console.log(`[AgentExecutor] Original tool input: ${JSON.stringify(toolCall, null, 2)}`);
            const fixedToolCall = {
              ...toolCall,
              args: {
                ...toolCall.args,
                collection_name, // always use dynamic collection_name
              },
            };
            console.log(`[AgentExecutor] Fixed tool input: ${JSON.stringify(fixedToolCall, null, 2)}`);
            const tool = tools.find(t => t.name === toolCall.name);
            if (!tool) {
              throw new Error(`Tool ${toolCall.name} not found`);
            }
            const result = await tool.invoke(fixedToolCall.args);
            if (typeof result === 'string' && result.includes('my_collection')) {
              return result.replace('my_collection', collection_name);
            }
            return result;
          },
        });
      } catch (error) {
        console.error(`[AgentExecutor] Failed to create agent executor: ${error.message}`);
        throw new Error(`Agent executor creation failed: ${error.message}`);
      }

      // Invoke agent with dynamic collection_name
      console.log(`[AgentExecutor] Invoking with collection_name: ${collection_name}, input: ${input}`);
      let response;
      try {
        response = await tempAgentExecutor.invoke({
          input,
          chat_history,
          collection_name, // dynamically passed
        });
        if (typeof response.output === 'string' && response.output.includes('my_collection')) {
          response.output = response.output.replace('my_collection', collection_name);
        }
      } catch (error) {
        console.error(`[AgentExecutor] Invocation failed: ${error.message}`);
        throw new Error(`Agent invocation failed: ${error.message}`);
      }

      console.log(`[AgentExecutor] Response: ${JSON.stringify(response, null, 2)}`);
      return response;
    },
  };
}

module.exports = initializeAgentExecutor;