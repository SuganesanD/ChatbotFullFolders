const fastify = require('fastify')({ logger: true });
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { ChatCohere } = require("@langchain/cohere");
const { milvusClient } = require('./config/milvusClient');
const initializeAgentExecutor = require('./chat/agent/langchainAgent');

require('dotenv').config({ path: '.env' });
const { embed } = require('./embed');
const {upsertMilvus} =require ('./upsertMilvus')


const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const COHERE_API_KEY = process.env.COHERE_API_KEY;

if (!GOOGLE_API_KEY) {
  console.error("GOOGLE_API_KEY environment variable is not set. Please set it in your .env file.");
  process.exit(1);
}

// Register CORS plugin
fastify.register(require('@fastify/cors'), {
  origin: '*', // Allow all origins for development; restrict in production
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: false // Set to true if cookies are needed
});


// Initialize LLM for template generation
const geminiChatModel = new ChatGoogleGenerativeAI({
  apiKey: GOOGLE_API_KEY,
  model: "gemini-2.0-flash",
  temperature: 0.1,
});

const cohereChatModel = new ChatCohere({
  apiKey: COHERE_API_KEY,
  model: "command-r-plus",
  temperature: 0.3,
});


let geminiAgentExecutor, cohereAgentExecutor;
async function initializeAgents() {
  try {
    // Initialize Gemini agent
    geminiAgentExecutor = await initializeAgentExecutor({ chatModel: geminiChatModel , milvusClient });
    console.log("Gemini LangChain AgentExecutor initialized.");

    // Initialize Cohere agent
    cohereAgentExecutor = await initializeAgentExecutor({ chatModel: cohereChatModel, milvusClient });
    console.log("Cohere LangChain AgentExecutor initialized.");
  } catch (error) {
    console.error("Failed to initialize LangChain AgentExecutors:", error);
    process.exit(1);
  }
}

// Call agent initialization
initializeAgents();

// Chat endpoint
fastify.post('/generateTemplate', {
  schema: {
    body: {
      type: 'object',
      properties: {
        input: { type: 'string' },
        modal: { type: 'string' }
      },
      required: ['input']
    },
    response: {
      200: {
        type: 'object',
        properties: {
          message: { type: 'string' }
        }
      }
    }
  },
  handler: async (request, reply) => {
    try {
      const { input, modal } = request.body;
      chatModel = modal === 'gemini' ? geminiChatModel : cohereChatModel
      console.log("modal:", modal);

      const llmPrompt = `You are an expert data summarizer. Your task is to create a concise, human-readable summary template for a data record.
I will provide you with an example data record.
Your output should be a single paragraph that uses placeholders for the actual data values.
Use double curly braces for placeholders, like \`{{fieldName}}\`.
Ensure the summary covers the most important aspects of a record, focusing on what a user would typically ask about.
Consider how dates (Unix timestamps) and boolean values should be naturally expressed in the summary.
Do not include any introductory or concluding remarks, just the summary paragraph.

Example Record (first record from JSON, use its values to understand context):
${JSON.stringify(input, null, 2)}

Generate the summary template (e.g., "Student {{studentName}} from {{schoolName}} requested {{leaveType}} leave..."):`;

      const response = await chatModel.invoke(llmPrompt);
      const generatedTemplate = response.content;
      return { message: generatedTemplate };
    } catch (error) {
      fastify.log.error(error);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  }
});

fastify.post('/embed', {
  schema: {
    body: {
      type: 'object',
      properties: {
        input: { type: 'string' }
      },
      required: ['input']
    },
    response: {
      200: {
        type: 'object',
        properties: {
          message: { type: 'string' }
        }
      }
    }
  },
  handler: async (request, reply) => {
    try {
      const { input } = request.body;
      const completionresponse = await embed(input, milvusClient);
      return { message: completionresponse };
    } catch (error) {
      fastify.log.error(error);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  }
});


// ✅ Define session store at the top of your server.js
const sessionStore = new Map();

fastify.post('/chat', {
  schema: {
    body: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        modal: { type: 'string' },
        query: { type: 'string' },
        sessionId: { type: 'string' }
      },
      required: ['collection', 'modal', 'query']
    },
    response: {
      200: {
        type: 'object',
        properties: {
          message: { type: 'string' }
        }
      }
    }
  },
  handler: async (request, reply) => {
    try {
      console.log('[/chat] Request body:', request.body);
      console.log('[/chat] Raw body:', request.raw.body);
      console.log('[/chat] Content-Type:', request.headers['content-type']);
      const { collection, modal, query, sessionId } = request.body;

      // ✅ Check if collection exists
      const hasCollection = await milvusClient.hasCollection({ collection_name: collection });
      console.log("hasCollection:",hasCollection);
      if (hasCollection.value) {
        console.log("****************collection exist****************");
      } else {
        throw new Error(`Collection ${collection} does not exist`);
      }


      // ✅ Check if collection is loaded
      const loadState = await milvusClient.getLoadState({ collection_name: collection });
      console.log("Load state before:",loadState);
      
      const isLoaded = loadState.state === 'LoadStateLoaded';
      console.log(`********************${isLoaded}*********************`);
      console.log("Load state:",loadState);


      // ✅ Load collection if not already loaded
      if (!isLoaded) {
        const loadedCollectionInstance=await milvusClient.loadCollectionSync({ collection_name: collection });
        console.log("Loaded collection Instance:",loadedCollectionInstance);
        

        // Poll to confirm loading completion
        let attempts = 0;
        const maxAttempts = 60;
        const pollInterval = 1000; // 1 second
        while (attempts < maxAttempts) {
          const state = await milvusClient.getLoadState({ collection_name: collection });
          console.log(`Attempt ${attempts}: Load state = ${state.state}`);
          if (state.state === 'LoadStateLoaded') {
            console.log(`Collection ${collection} loaded successfully`);
            break;
          }
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          attempts++;
        }
        if (attempts >= maxAttempts) {
          throw new Error(`Failed to load collection ${collection} within timeout`);
        }
      }

      // ✅ Select the appropriate agent based on modal
      const agentExecutor = modal === 'gemini' ? geminiAgentExecutor : cohereAgentExecutor;
      if (!agentExecutor) {
        throw new Error('AgentExecutor not initialized for the selected modal');
      }

      // ✅ Retrieve or initialize session history
      let history = [];
      if (sessionId) {
        if (!sessionStore.has(sessionId)) {
          sessionStore.set(sessionId, []); // initialize new session
        }
        history = sessionStore.get(sessionId);
      }

      // ✅ Call the agent with query, collection, and history
      const response = await agentExecutor.invoke({
        input: query,
        collection_name: collection,
        chat_history: history
      });
      const agentResponse = response.output || response.content;

      // ✅ Update session history
      if (sessionId) {
        history.push({ role: 'user', content: query });
        history.push({ role: 'assistant', content: agentResponse });
        sessionStore.set(sessionId, history); // update Map
      }

      return { message: agentResponse };
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  }
});


fastify.post('/upsertMilvus', {
  schema: {
    body: {
      type: 'object',
      properties: {
        input: { type: 'string' }
      },
      required: ['input']
    },
    response: {
      200: {
        type: 'object',
        properties: {
          message: { type: 'string' }
        }
      }
    }
  },
  handler: async (request, reply) => {
    try {
      const { input } = request.body;
      const parsedInput= JSON.parse(input)
      console.log(parsedInput);
      
      const completionresponse = await upsertMilvus( milvusClient,parsedInput);
      
      return completionresponse;
      
    } catch (error) {
      fastify.log.error(error);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  }
});

// Error handling
fastify.setErrorHandler((error,request,reply) => {
  fastify.log.error(error);
  reply.code(500).send({ error: 'Something went wrong' });
});


// Start the server
const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
    console.log('Server running at http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();