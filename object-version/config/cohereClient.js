const { CohereClient } = require('cohere-ai');


const cohere = new CohereClient();

async function generateCohereResponse(prompt) {

            const response = await cohere.generate({
                model: 'command-r-plus', // Use 'command-r' if 'plus' is not available to you
                prompt: prompt,
                temperature: 0.5,
                stop_sequences: [],
            });

            const answer = response.generations[0].text.trim();
            return answer;
        }

module.exports={generateCohereResponse}       


