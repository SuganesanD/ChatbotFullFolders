// langchain.js (CommonJS)

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { RunnableSequence } = require("@langchain/core/runnables");
const { StringOutputParser } = require("@langchain/core/output_parsers");
require("dotenv").config(); // to load GOOGLE_API_KEY

const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GOOGLE_API_KEY, // or set directly here
});

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  ["human", "{input}"],
]);

const chain = RunnableSequence.from([
  prompt,
  model,
  new StringOutputParser(),
]);

async function main() {
  const result = await chain.invoke({ input: "What is LangChain used for?" });
  console.log(result);
}

main();
