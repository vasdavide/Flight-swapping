import { GoogleGenAI, Type } from "@google/genai";

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[getAI] GEMINI_API_KEY is missing from the environment.");
    throw new Error("GEMINI_API_KEY is not set. Please configure it in the AI Studio Secrets panel.");
  }
  return new GoogleGenAI({ apiKey });
}

export async function parseFlight(flightCode: string, dateString: string) {
  console.log(`[parseFlight] Starting parse for ${flightCode} on ${dateString}`);
  const ai = getAI();
  try {
    // Attempt 1: With Google Search
    console.log(`[parseFlight] Attempting with Google Search using gemini-3.1-pro-preview...`);
    let response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: `Use Google Search to find the current route and schedule for flight code "${flightCode}" on ${dateString}. 
      I need the departure city, arrival city, departure time (local), arrival time (local), aircraft type, and any layover information if applicable.
      Search for the actual route (e.g. if CI104, search "CI104 flight route").
      Return ONLY a JSON object with these keys: departure_city, arrival_city, departure_time, arrival_time, aircraft, layover.`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            departure_city: { type: Type.STRING },
            arrival_city: { type: Type.STRING },
            departure_time: { type: Type.STRING, description: "HH:mm" },
            arrival_time: { type: Type.STRING, description: "HH:mm" },
            aircraft: { type: Type.STRING },
            layover: { type: Type.STRING },
          },
        }
      }
    });

    console.log(`[parseFlight] Google Search response received:`, response.text);
    return JSON.parse(response.text || '{}');
  } catch (searchErr: any) {
    console.warn("[parseFlight] Search grounding failed:", searchErr);
    
    // Check for specific error messages that might indicate API key issues
    if (searchErr.message?.includes("API_KEY_INVALID") || searchErr.message?.includes("not found")) {
      console.error("[parseFlight] Critical API Key error detected.");
    }

    // Attempt 2: Fallback
    console.log(`[parseFlight] Attempting fallback without tools...`);
    try {
      let response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: `Parse this flight code "${flightCode}" for the date ${dateString}. 
        Provide the likely flight details (departure city, arrival city, departure time, arrival_time).
        Return ONLY a JSON object with these keys: departure_city, arrival_city, departure_time, arrival_time.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              departure_city: { type: Type.STRING },
              arrival_city: { type: Type.STRING },
              departure_time: { type: Type.STRING, description: "HH:mm" },
              arrival_time: { type: Type.STRING, description: "HH:mm" },
            },
          }
        }
      });
      console.log(`[parseFlight] Fallback response received:`, response.text);
      return JSON.parse(response.text || '{}');
    } catch (fallbackErr) {
      console.error("[parseFlight] Fallback also failed:", fallbackErr);
      throw fallbackErr;
    }
  }
}

export async function scanSchedule(base64Data: string, mimeType: string) {
  const ai = getAI();
  try {
    console.log(`[scanSchedule] Scanning schedule image with gemini-3.1-pro-preview...`);
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [
        { inlineData: { data: base64Data, mimeType } },
        { text: "Extract all schedule entries from this image. For each flight code found, use your Google Search tool to find its departure city, arrival city, departure_time, arrival_time, aircraft type, and layover info. Return ONLY a JSON array of objects with: flight_code, departure_city, arrival_city, departure_time, arrival_time, aircraft, layover." }
      ],
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              flight_code: { type: Type.STRING },
              departure_city: { type: Type.STRING },
              arrival_city: { type: Type.STRING },
              departure_time: { type: Type.STRING },
              arrival_time: { type: Type.STRING },
              aircraft: { type: Type.STRING },
              layover: { type: Type.STRING }
            },
            required: ["flight_code", "departure_city", "arrival_city", "departure_time", "arrival_time"]
          }
        }
      }
    });
    
    console.log(`[scanSchedule] Response received:`, response.text);
    return JSON.parse(response.text || '[]');
  } catch (err) {
    console.error("[scanSchedule] Schedule scanning failed:", err);
    return [];
  }
}

export async function editImage(base64Data: string, prompt: string) {
  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType: 'image/png' } },
          { text: prompt }
        ]
      }
    });

    let editedImage = null;
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        editedImage = `data:image/png;base64,${part.inlineData.data}`;
        break;
      }
    }

    return editedImage;
  } catch (err) {
    console.error("Image editing failed", err);
    return null;
  }
}
