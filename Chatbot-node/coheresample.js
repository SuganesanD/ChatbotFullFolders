// cohere-chat.js
import dotenv from 'dotenv';
dotenv.config({ path: './couchdb_credentials.env' });

import readline from 'readline';
import { CohereClient } from 'cohere-ai';

const cohere = new CohereClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const conversation = []; // To hold chat history

async function askQuestion() {
  rl.question('🧑 You: ', async (userInput) => {
    if (userInput.toLowerCase() === 'exit') {
      console.log('👋 Goodbye!');
      rl.close();
      return;
    }

    // Add user message to chat history
    conversation.push({ role: 'USER', message: userInput });

    try {
      const response = await cohere.chat({
        model: "command-r-plus",
        chatHistory: conversation,
        message: userInput
      });

      const reply = response.text;
      console.log(`🤖 Cohere: ${reply}\n`);

      // Add assistant response to chat history
      conversation.push({ role: 'CHATBOT', message: reply });
    } catch (error) {
      console.error('❌ Error:', error.message || error);
    }

    askQuestion(); // Repeat
  });
}

// Start chatting
console.log('💬 Start chatting with Cohere! (type "exit" to quit)');
askQuestion();
