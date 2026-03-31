import { GoogleGenAI, Modality } from "@google/genai";

function getAI() {
  // Use process.env.API_KEY which is updated after the user selects a key in the dialog
  const apiKey = (process.env as any).API_KEY || process.env.GEMINI_API_KEY || "";
  return new GoogleGenAI({ apiKey });
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMsg = error?.message ? String(error.message) : "";
      const isRetryable = errorMsg.includes("503") || 
                          error?.status === "UNAVAILABLE" ||
                          errorMsg.includes("high demand");
      
      if (isRetryable && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
        console.warn(`Retrying after ${delay}ms due to high demand (attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("Retry failed with no error captured");
}

export async function generateStory(theme: string) {
  const ai = getAI();
  const response = await withRetry(() => ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Create a 200-300 word bedtime story for children based on the theme: "${theme}". 
    The story should be magical, heartwarming, and suitable for a young audience. 
    Format the response as JSON with "title" and "content" fields.`,
    config: {
      responseMimeType: "application/json",
    },
  }));

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to parse story JSON", e);
    return { title: "A Magical Tale", content: response.text };
  }
}

export async function generateIllustration(prompt: string) {
  const ai = getAI();
  const response = await withRetry(() => ai.models.generateImages({
    model: "imagen-4.0-generate-001",
    prompt: `A high-quality 3D character render in the style of modern Disney and Pixar animation. 
    The focus is on the main characters: ${prompt}. 
    The scene features a warm, dreamy ambience with soft, glowing lighting, vibrant yet gentle colors, and a magical storybook atmosphere. 
    Expressive character design, cinematic depth of field, and a whimsical, heartwarming feel.`,
    config: {
      numberOfImages: 1,
      aspectRatio: "1:1",
    },
  }));

  const image = response.generatedImages?.[0];
  if (!image || !image.image) {
    throw new Error("No illustration was generated");
  }

  const base64EncodeString = image.image.imageBytes;
  return `data:image/png;base64,${base64EncodeString}`;
}

export async function generateNarration(text: string) {
  const ai = getAI();
  const response = await withRetry(() => ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Read this story in a soothing, gentle, and expressive narrator's voice: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Kore" }, // Kore is a good gentle voice
        },
      },
    },
  }));

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
}
