const fastify = require('fastify')({ logger: true });
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { ChatCohere } = require("@langchain/cohere");
require('dotenv').config({ path:  '.env'});
const { embed } = require('./embed');


const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const COHERE_API_KEY=process.env.COHERE_API_KEY;

if (!GOOGLE_API_KEY) {
    console.error("GOOGLE_API_KEY environment variable is not set. Please set it in your .env file.");
    process.exit(1);
}

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

// Register CORS plugin
fastify.register(require('@fastify/cors'), {
  origin: '*', // Allow all origins for development; restrict in production
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: false // Set to true if cookies are needed
});

// Chat endpoint
fastify.post('/generateTemplate', {
  schema: {
    body: {
      type: 'object',
      properties: {
        input: { type: 'string' },
        modal:{type:'string'}
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
      const { input ,modal} = request.body;
      chatModel=modal==='gemini'?geminiChatModel:cohereChatModel
      console.log("modal:",modal);
      
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
        const completionresponse = await embed(input);
        return { message: completionresponse };
    } catch (error) {
      fastify.log.error(error);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  }
});

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  reply.status(500).send({ error: 'Something went wrong' });
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