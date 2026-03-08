import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("skycrew.db");

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS flights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    flight_code TEXT,
    departure_city TEXT,
    arrival_city TEXT,
    departure_time TEXT,
    arrival_time TEXT,
    date TEXT
  );

  CREATE TABLE IF NOT EXISTS swap_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_email TEXT,
    flight_id INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(flight_id) REFERENCES flights(id)
  );

  CREATE TABLE IF NOT EXISTS swap_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER,
    proposer_email TEXT,
    proposer_flight_id INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(listing_id) REFERENCES swap_requests(id),
    FOREIGN KEY(proposer_flight_id) REFERENCES flights(id)
  );
`);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/flights", (req, res) => {
    const email = req.query.email as string;
    const flights = db.prepare("SELECT * FROM flights WHERE user_email = ?").all(email);
    res.json(flights);
  });

  app.post("/api/flights", (req, res) => {
    const { user_email, flight_code, departure_city, arrival_city, departure_time, arrival_time, date } = req.body;
    const info = db.prepare(`
      INSERT INTO flights (user_email, flight_code, departure_city, arrival_city, departure_time, arrival_time, date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user_email, flight_code, departure_city, arrival_city, departure_time, arrival_time, date);
    res.json({ id: info.lastInsertRowid });
  });

  app.delete("/api/flights/:id", (req, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM swap_proposals WHERE listing_id IN (SELECT id FROM swap_requests WHERE flight_id = ?)").run(id);
    db.prepare("DELETE FROM swap_proposals WHERE proposer_flight_id = ?").run(id);
    db.prepare("DELETE FROM swap_requests WHERE flight_id = ?").run(id);
    db.prepare("DELETE FROM flights WHERE id = ?").run(id);
    res.json({ success: true });
  });

  app.get("/api/swaps", (req, res) => {
    const swaps = db.prepare(`
      SELECT sr.*, f.flight_code, f.departure_city, f.arrival_city, f.date, f.departure_time
      FROM swap_requests sr
      JOIN flights f ON sr.flight_id = f.id
      WHERE sr.status = 'pending'
    `).all();
    res.json(swaps);
  });

  app.post("/api/swaps", (req, res) => {
    const { requester_email, flight_id } = req.body;
    // Check if already listed
    const existing = db.prepare("SELECT * FROM swap_requests WHERE flight_id = ? AND status = 'pending'").get(flight_id);
    if (existing) return res.status(400).json({ error: "Flight already listed" });

    const info = db.prepare("INSERT INTO swap_requests (requester_email, flight_id) VALUES (?, ?)").run(requester_email, flight_id);
    res.json({ id: info.lastInsertRowid });
  });

  app.delete("/api/swaps/:id", (req, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM swap_proposals WHERE listing_id = ?").run(id);
    db.prepare("DELETE FROM swap_requests WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // Proposals
  app.post("/api/proposals", (req, res) => {
    const { listing_id, proposer_email, proposer_flight_id } = req.body;
    const info = db.prepare(`
      INSERT INTO swap_proposals (listing_id, proposer_email, proposer_flight_id)
      VALUES (?, ?, ?)
    `).run(listing_id, proposer_email, proposer_flight_id);
    res.json({ id: info.lastInsertRowid });
  });

  app.get("/api/proposals/incoming", (req, res) => {
    const email = req.query.email as string;
    const proposals = db.prepare(`
      SELECT sp.*, 
             f_offered.flight_code as offered_code, f_offered.departure_city as offered_dep, f_offered.arrival_city as offered_arr, f_offered.date as offered_date,
             f_mine.flight_code as my_code, f_mine.departure_city as my_dep, f_mine.arrival_city as my_arr, f_mine.date as my_date
      FROM swap_proposals sp
      JOIN swap_requests sr ON sp.listing_id = sr.id
      JOIN flights f_mine ON sr.flight_id = f_mine.id
      JOIN flights f_offered ON sp.proposer_flight_id = f_offered.id
      WHERE sr.requester_email = ? AND sp.status = 'pending'
    `).all(email);
    res.json(proposals);
  });

  app.get("/api/proposals/outgoing", (req, res) => {
    const email = req.query.email as string;
    const proposals = db.prepare(`
      SELECT sp.*, 
             f_offered.flight_code as offered_code, f_offered.departure_city as offered_dep, f_offered.arrival_city as offered_arr, f_offered.date as offered_date,
             f_target.flight_code as target_code, f_target.departure_city as target_dep, f_target.arrival_city as target_arr, f_target.date as target_date
      FROM swap_proposals sp
      JOIN swap_requests sr ON sp.listing_id = sr.id
      JOIN flights f_target ON sr.flight_id = f_target.id
      JOIN flights f_offered ON sp.proposer_flight_id = f_offered.id
      WHERE sp.proposer_email = ?
    `).all(email);
    res.json(proposals);
  });

  app.get("/api/candidates", (req, res) => {
    const date = req.query.date as string;
    const email = req.query.email as string;
    
    if (!date || !email) {
      return res.status(400).json({ error: "Missing date or email" });
    }

    const candidates = db.prepare(`
      SELECT DISTINCT user_email 
      FROM flights 
      WHERE user_email != ? 
      AND user_email NOT IN (
        SELECT user_email FROM flights WHERE date = ?
      )
    `).all(email, date);
    
    res.json(candidates.map((c: any) => c.user_email));
  });

  // AI Routes
  app.post("/api/ai/parse-flight", async (req, res) => {
    const { flightCode, date } = req.body;
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Parse this flight code "${flightCode}" for the date ${date}. 
        If it's a real-looking code (like AA123, BA456), generate plausible flight details (departure city, arrival city, departure time, arrival time).
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
            required: ["departure_city", "arrival_city", "departure_time", "arrival_time"]
          }
        }
      });
      res.json(JSON.parse(response.text || '{}'));
    } catch (err) {
      console.error("AI Parse Error:", err);
      res.status(500).json({ error: "Failed to parse flight code" });
    }
  });

  app.post("/api/ai/scan-schedule", async (req, res) => {
    const { base64Data, mimeType } = req.body;
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { inlineData: { data: base64Data, mimeType } },
          { text: "Extract all flights from this schedule. Return ONLY a JSON array of objects with: flight_code, departure_city, arrival_city, departure_time (HH:mm), arrival_time (HH:mm), date (YYYY-MM-DD)." }
        ],
        config: {
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
                date: { type: Type.STRING },
              },
              required: ["flight_code", "departure_city", "arrival_city", "departure_time", "arrival_time", "date"]
            }
          }
        }
      });
      res.json(JSON.parse(response.text || '[]'));
    } catch (err) {
      console.error("AI Scan Error:", err);
      res.status(500).json({ error: "Failed to scan schedule" });
    }
  });

  app.post("/api/ai/edit-image", async (req, res) => {
    const { base64Data, prompt } = req.body;
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
      
      let resultImage = null;
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          resultImage = part.inlineData.data;
          break;
        }
      }
      res.json({ base64Data: resultImage });
    } catch (err) {
      console.error("AI Edit Error:", err);
      res.status(500).json({ error: "Failed to edit image" });
    }
  });

  app.patch("/api/proposals/:id", (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'accepted' or 'declined'

    if (status === 'accepted') {
      const proposal = db.prepare("SELECT * FROM swap_proposals WHERE id = ?").get(id);
      const listing = db.prepare("SELECT * FROM swap_requests WHERE id = ?").get(proposal.listing_id);
      
      const myFlightId = listing.flight_id;
      const offeredFlightId = proposal.proposer_flight_id;

      const myFlight = db.prepare("SELECT * FROM flights WHERE id = ?").get(myFlightId);
      const offeredFlight = db.prepare("SELECT * FROM flights WHERE id = ?").get(offeredFlightId);

      // Perform the swap
      db.prepare("UPDATE flights SET user_email = ? WHERE id = ?").run(offeredFlight.user_email, myFlightId);
      db.prepare("UPDATE flights SET user_email = ? WHERE id = ?").run(myFlight.user_email, offeredFlightId);

      // Mark listing as completed
      db.prepare("UPDATE swap_requests SET status = 'completed' WHERE id = ?").run(listing.id);
      
      // Mark proposal as accepted
      db.prepare("UPDATE swap_proposals SET status = 'accepted' WHERE id = ?").run(id);

      // Decline all other proposals for this listing
      db.prepare("UPDATE swap_proposals SET status = 'declined' WHERE listing_id = ? AND id != ?").run(listing.id, id);
    } else {
      db.prepare("UPDATE swap_proposals SET status = ? WHERE id = ?").run(status, id);
    }

    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
