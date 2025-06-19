import { GoogleGenAI, Modality } from "@google/genai";
import * as fs from "node:fs";

// Replace this with your actual Gemini API key
const API_KEY = "AIzaSyD4zXj3LQtUGxPRbAwxkVM4lzZpQE6urOk";

async function main() {
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt ="give me a donut chart for the gender ratio 3:5 ";

  // Call the model with both text and image response modalities
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash-preview-image-generation",
    contents: prompt,
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  // Process the response
  for (const part of response.candidates[0].content.parts) {
    if (part.text) {
      console.log("📝 Description:\n", part.text);
    } else if (part.inlineData) {
      const buffer = Buffer.from(part.inlineData.data, "base64");
      fs.writeFileSync("generated-image.png", buffer);
      console.log("🖼️ Image saved as: generated-image.png");
    }
  }
}

main().catch(console.error);
