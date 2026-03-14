import { GoogleGenAI, Type } from "@google/genai";

let runtimeApiKey: string | null = null;

export function setRuntimeApiKey(key: string) {
  runtimeApiKey = key;
}

function getAI() {
  const apiKey = runtimeApiKey || process.env.GEMINI_API_KEY;
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
    console.log(`[parseFlight] Attempting with Google Search using gemini-3-flash-preview...`);
    let response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Search for the flight details of "${flightCode}" on ${dateString}. 
      Prioritize official airline websites like China Airlines (china-airlines.com), EVA Air, or flight tracking sites like FlightAware and FlightRadar24.
      I need:
      1. Departure City
      2. Arrival City
      3. Departure Time (Local HH:mm)
      4. Arrival Time (Local HH:mm)
      5. Aircraft Type
      6. Layover (if any)
      
      Return ONLY a JSON object with these keys: departure_city, arrival_city, departure_time, arrival_time, aircraft, layover.`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            departure_city: { type: Type.STRING },
            arrival_city: { type: Type.STRING },
            departure_time: { type: Type.STRING },
            arrival_time: { type: Type.STRING },
            aircraft: { type: Type.STRING },
            layover: { type: Type.STRING },
          },
          required: ["departure_city", "arrival_city", "departure_time", "arrival_time"]
        }
      }
    });

    console.log(`[parseFlight] Google Search response received:`, response.text);
    try {
      const parsed = JSON.parse(response.text || '{}');
      if (parsed.departure_city && parsed.arrival_city) return parsed;
      throw new Error("Incomplete data from search");
    } catch (e) {
      console.warn("[parseFlight] Failed to parse search response, trying fallback", e);
      throw e; 
    }
  } catch (searchErr: any) {
    console.warn("[parseFlight] Search grounding failed or returned invalid data:", searchErr);
    
    // Attempt 2: Fallback without tools
    console.log(`[parseFlight] Attempting fallback without tools...`);
    try {
      let response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Provide the typical flight schedule for flight code "${flightCode}". 
        The date is ${dateString}. If you don't know the exact time, provide the most common schedule for this flight number.
        Return ONLY a JSON object with these keys: departure_city, arrival_city, departure_time, arrival_time.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              departure_city: { type: Type.STRING },
              arrival_city: { type: Type.STRING },
              departure_time: { type: Type.STRING },
              arrival_time: { type: Type.STRING },
            },
            required: ["departure_city", "arrival_city"]
          }
        }
      });
      console.log(`[parseFlight] Fallback response received:`, response.text);
      return JSON.parse(response.text || '{}');
    } catch (fallbackErr) {
      console.error("[parseFlight] Fallback also failed:", fallbackErr);
      return { departure_city: 'Unknown', arrival_city: 'Unknown', departure_time: '00:00', arrival_time: '00:00' };
    }
  }
}

export async function scanSchedule(base64Data: string, mimeType: string) {
  const ai = getAI();
  try {
    console.log(`[scanSchedule] Scanning schedule image with gemini-3-flash-preview...`);
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { inlineData: { data: base64Data, mimeType } },
        { text: "Extract all schedule entries from this image. For each day, identify if it's a flight or a day off (OFF/AL/Leave). For flights, find route details using Google Search. Return ONLY a JSON array of objects with: type ('flight' or 'off'), flight_code (if flight), departure_city, arrival_city, departure_time, arrival_time, aircraft, layover." }
      ],
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, enum: ['flight', 'off'] },
              flight_code: { type: Type.STRING },
              departure_city: { type: Type.STRING },
              arrival_city: { type: Type.STRING },
              departure_time: { type: Type.STRING },
              arrival_time: { type: Type.STRING },
              aircraft: { type: Type.STRING },
              layover: { type: Type.STRING }
            },
            required: ["type"]
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
