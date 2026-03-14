import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("skycrew.db");

function addColumnIfNotExists(tableName: string, columnName: string, columnDefinition: string) {
  try {
    const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
    const columnExists = tableInfo.some(col => col.name === columnName);
    if (!columnExists) {
      db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`).run();
      console.log(`Added column ${columnName} to ${tableName}`);
    }
  } catch (e) {
    console.error(`Error adding column ${columnName} to ${tableName}:`, e);
  }
}

addColumnIfNotExists("flights", "pilot", "TEXT");
addColumnIfNotExists("flights", "aircraft", "TEXT");
addColumnIfNotExists("flights", "layover", "TEXT");
addColumnIfNotExists("flights", "group_id", "TEXT");
addColumnIfNotExists("flights", "is_duty", "INTEGER DEFAULT 0");
addColumnIfNotExists("swap_requests", "return_flight_id", "INTEGER");
addColumnIfNotExists("swap_requests", "group_id", "TEXT");
addColumnIfNotExists("swap_proposals", "proposer_flight_id_return", "INTEGER");

// Initialize Gemini
// const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
    date TEXT,
    pilot TEXT,
    aircraft TEXT,
    layover TEXT,
    group_id TEXT,
    is_duty INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS swap_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_email TEXT,
    flight_id INTEGER,
    return_flight_id INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(flight_id) REFERENCES flights(id),
    FOREIGN KEY(return_flight_id) REFERENCES flights(id)
  );

  CREATE TABLE IF NOT EXISTS swap_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER,
    proposer_email TEXT,
    proposer_flight_id INTEGER,
    proposer_flight_id_return INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(listing_id) REFERENCES swap_requests(id),
    FOREIGN KEY(proposer_flight_id) REFERENCES flights(id),
    FOREIGN KEY(proposer_flight_id_return) REFERENCES flights(id)
  );

  CREATE TABLE IF NOT EXISTS annual_leaves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_email, date)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_email TEXT,
    sender_email TEXT,
    message TEXT,
    type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_read INTEGER DEFAULT 0
  );
`);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  console.log("Starting server...");
  console.log("NODE_ENV:", process.env.NODE_ENV);
  console.log("PORT:", PORT);
  console.log("__dirname:", __dirname);

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV });
  });

  // API Routes
  app.get("/api/flights", (req, res) => {
    const email = req.query.email as string;
    const flights = db.prepare("SELECT * FROM flights WHERE user_email = ?").all(email);
    res.json(flights);
  });

  app.post("/api/flights", (req, res) => {
    const { user_email, flight_code, departure_city, arrival_city, departure_time, arrival_time, date, pilot, aircraft, layover, group_id, is_duty } = req.body;
    const info = db.prepare(`
      INSERT INTO flights (user_email, flight_code, departure_city, arrival_city, departure_time, arrival_time, date, pilot, aircraft, layover, group_id, is_duty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user_email, flight_code, departure_city, arrival_city, departure_time, arrival_time, date, pilot, aircraft, layover, group_id, is_duty ? 1 : 0);
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
    console.log("[GET /api/swaps] Fetching pending swaps...");
    try {
      const swaps = db.prepare(`
        SELECT sr.*, 
               f.flight_code, f.departure_city, f.arrival_city, f.date, f.departure_time,
               f2.flight_code as return_code, f2.departure_city as return_dep, f2.arrival_city as return_arr, f2.date as return_date, f2.departure_time as return_time
        FROM swap_requests sr
        LEFT JOIN flights f ON (
          sr.flight_id = f.id OR 
          (sr.group_id IS NOT NULL AND f.id = (SELECT id FROM flights WHERE group_id = sr.group_id ORDER BY id ASC LIMIT 1))
        )
        LEFT JOIN flights f2 ON (
          sr.return_flight_id = f2.id OR 
          (sr.group_id IS NOT NULL AND f2.id = (SELECT id FROM flights WHERE group_id = sr.group_id ORDER BY id ASC LIMIT 1 OFFSET 1))
        )
        WHERE sr.status = 'pending'
      `).all();
      console.log(`[GET /api/swaps] Found ${swaps.length} swaps.`);
      res.json(swaps);
    } catch (err) {
      console.error("[GET /api/swaps] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/swaps", (req, res) => {
    const { requester_email, flight_id, return_flight_id, group_id } = req.body;
    // Check if already listed
    let existing;
    if (group_id) {
        existing = db.prepare("SELECT * FROM swap_requests WHERE group_id = ? AND status = 'pending'").get(group_id);
    } else {
        existing = db.prepare("SELECT * FROM swap_requests WHERE flight_id = ? AND status = 'pending'").get(flight_id);
    }
    if (existing) return res.status(400).json({ error: "Flight already listed" });

    const info = db.prepare("INSERT INTO swap_requests (requester_email, flight_id, return_flight_id, group_id) VALUES (?, ?, ?, ?)").run(requester_email, flight_id || null, return_flight_id || null, group_id || null);
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
    const { listing_id, proposer_email, proposer_flight_id, proposer_flight_id_return } = req.body;
    const info = db.prepare(`
      INSERT INTO swap_proposals (listing_id, proposer_email, proposer_flight_id, proposer_flight_id_return)
      VALUES (?, ?, ?, ?)
    `).run(listing_id, proposer_email, proposer_flight_id, proposer_flight_id_return);
    res.json({ id: info.lastInsertRowid });
  });

  app.get("/api/proposals/incoming", (req, res) => {
    const email = req.query.email as string;
    const proposals = db.prepare(`
      SELECT sp.*, 
             f_offered.flight_code as offered_code, f_offered.departure_city as offered_dep, f_offered.arrival_city as offered_arr, f_offered.date as offered_date,
             f_offered_ret.flight_code as offered_ret_code, f_offered_ret.date as offered_ret_date,
             f_mine.flight_code as my_code, f_mine.departure_city as my_dep, f_mine.arrival_city as my_arr, f_mine.date as my_date,
             f_mine_ret.flight_code as my_ret_code, f_mine_ret.date as my_ret_date
      FROM swap_proposals sp
      JOIN swap_requests sr ON sp.listing_id = sr.id
      JOIN flights f_mine ON sr.flight_id = f_mine.id
      LEFT JOIN flights f_mine_ret ON sr.return_flight_id = f_mine_ret.id
      LEFT JOIN flights f_offered ON sp.proposer_flight_id = f_offered.id
      LEFT JOIN flights f_offered_ret ON sp.proposer_flight_id_return = f_offered_ret.id
      WHERE sr.requester_email = ? AND sp.status = 'pending'
    `).all(email);
    res.json(proposals);
  });

  app.get("/api/proposals/outgoing", (req, res) => {
    const email = req.query.email as string;
    const proposals = db.prepare(`
      SELECT sp.*, 
             f_offered.flight_code as offered_code, f_offered.departure_city as offered_dep, f_offered.arrival_city as offered_arr, f_offered.date as offered_date,
             f_offered_ret.flight_code as offered_ret_code, f_offered_ret.date as offered_ret_date,
             f_target.flight_code as target_code, f_target.departure_city as target_dep, f_target.arrival_city as target_arr, f_target.date as target_date,
             f_target_ret.flight_code as target_ret_code, f_target_ret.date as target_ret_date
      FROM swap_proposals sp
      JOIN swap_requests sr ON sp.listing_id = sr.id
      JOIN flights f_target ON sr.flight_id = f_target.id
      LEFT JOIN flights f_target_ret ON sr.return_flight_id = f_target_ret.id
      LEFT JOIN flights f_offered ON sp.proposer_flight_id = f_offered.id
      LEFT JOIN flights f_offered_ret ON sp.proposer_flight_id_return = f_offered_ret.id
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

    // Candidates are people who are either on Annual Leave OR just happen to be off
    const candidates = db.prepare(`
      SELECT DISTINCT user_email, 
             (SELECT 1 FROM annual_leaves al WHERE al.user_email = f.user_email AND al.date = ?) as is_al
      FROM flights f
      WHERE user_email != ? 
      AND user_email NOT IN (
        SELECT user_email FROM flights WHERE date = ?
      )
    `).all(date, email, date);
    
    res.json(candidates.map((c: any) => ({
      email: c.user_email,
      is_al: !!c.is_al
    })));
  });

  app.get("/api/annual-leaves", (req, res) => {
    const email = req.query.email as string;
    const leaves = db.prepare("SELECT date FROM annual_leaves WHERE user_email = ?").all(email);
    res.json(leaves.map((l: any) => l.date));
  });

  app.post("/api/annual-leaves/toggle", (req, res) => {
    const { email, date } = req.body;
    const existing = db.prepare("SELECT id FROM annual_leaves WHERE user_email = ? AND date = ?").get(email, date);
    
    if (existing) {
      db.prepare("DELETE FROM annual_leaves WHERE user_email = ? AND date = ?").run(email, date);
      res.json({ status: 'removed' });
    } else {
      db.prepare("INSERT INTO annual_leaves (user_email, date) VALUES (?, ?)").run(email, date);
      res.json({ status: 'added' });
    }
  });

  app.get("/api/available-crew", (req, res) => {
    console.log("[GET /api/available-crew] Fetching available crew...");
    try {
      const crew = db.prepare(`
        SELECT al.*, 
               (SELECT COUNT(*) FROM flights f WHERE f.user_email = al.user_email AND f.date = al.date) as has_flight
        FROM annual_leaves al
        WHERE al.date >= date('now', '-1 day')
        ORDER BY al.user_email, al.date ASC
      `).all() as any[];

      console.log(`[GET /api/available-crew] Found ${crew.length} raw leave entries.`);
      const filtered = crew.filter(c => c.has_flight === 0);
      console.log(`[GET /api/available-crew] Found ${filtered.length} crew without flights.`);
      
      const grouped: any[] = [];
      if (filtered.length === 0) {
        return res.json([]);
      }

      let currentRange: any = null;
      for (const item of filtered) {
        if (!currentRange) {
          currentRange = {
            user_email: item.user_email,
            startDate: item.date,
            endDate: item.date,
            dates: [item.date]
          };
        } else if (currentRange.user_email === item.user_email) {
          const date1 = currentRange.endDate.substring(0, 10);
          const date2 = item.date.substring(0, 10);
          const d1 = new Date(date1 + 'T00:00:00Z');
          const d2 = new Date(date2 + 'T00:00:00Z');
          const diff = d2.getTime() - d1.getTime();
          const oneDay = 24 * 60 * 60 * 1000;

          if (Math.abs(diff - oneDay) < 1000) {
            currentRange.endDate = item.date;
            currentRange.dates.push(item.date);
          } else {
            grouped.push(currentRange);
            currentRange = {
              user_email: item.user_email,
              startDate: item.date,
              endDate: item.date,
              dates: [item.date]
            };
          }
        } else {
          grouped.push(currentRange);
          currentRange = {
            user_email: item.user_email,
            startDate: item.date,
            endDate: item.date,
            dates: [item.date]
          };
        }
      }
      if (currentRange) grouped.push(currentRange);
      
      console.log(`[GET /api/available-crew] Returning ${grouped.length} grouped crew ranges.`);
      res.json(grouped);
    } catch (err) {
      console.error("[GET /api/available-crew] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/notifications", (req, res) => {
    const email = req.query.email as string;
    const notifications = db.prepare("SELECT * FROM notifications WHERE recipient_email = ? ORDER BY created_at DESC").all(email);
    res.json(notifications);
  });

  app.post("/api/notifications", (req, res) => {
    const { recipient_email, sender_email, message, type } = req.body;
    const info = db.prepare(`
      INSERT INTO notifications (recipient_email, sender_email, message, type)
      VALUES (?, ?, ?, ?)
    `).run(recipient_email, sender_email, message, type);
    res.json({ id: info.lastInsertRowid });
  });

  app.delete("/api/notifications/:id", (req, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM notifications WHERE id = ?").run(id);
    res.json({ success: true });
  });

  app.post("/api/notifications/read-all", (req, res) => {
    const { email } = req.body;
    db.prepare("UPDATE notifications SET is_read = 1 WHERE recipient_email = ?").run(email);
    res.json({ success: true });
  });

  // End of API Routes

  // End of API Routes

  // End of API Routes

  app.patch("/api/proposals/:id", (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'accepted' or 'declined'

    if (status === 'accepted') {
      const proposal = db.prepare("SELECT * FROM swap_proposals WHERE id = ?").get(id);
      const listing = db.prepare("SELECT * FROM swap_requests WHERE id = ?").get(proposal.listing_id);
      
      let requesterFlights = [];
      if (listing.group_id) {
        requesterFlights = db.prepare("SELECT * FROM flights WHERE group_id = ? ORDER BY id ASC").all(listing.group_id);
      } else {
        const f1 = db.prepare("SELECT * FROM flights WHERE id = ?").get(listing.flight_id);
        if (f1) requesterFlights.push(f1);
        if (listing.return_flight_id) {
          const f2 = db.prepare("SELECT * FROM flights WHERE id = ?").get(listing.return_flight_id);
          if (f2) requesterFlights.push(f2);
        }
      }

      if (requesterFlights.length === 0) return res.status(400).json({ error: "No flights found for this listing" });

      const requesterEmail = requesterFlights[0].user_email;
      const proposerEmail = proposal.proposer_email;

      const offeredFlightId = proposal.proposer_flight_id;
      const offeredReturnId = proposal.proposer_flight_id_return;

      // Swap main flight(s)
      if (offeredFlightId) {
        // 1-for-1 or Group-for-1
        const offeredEmail = db.prepare("SELECT user_email FROM flights WHERE id = ?").get(offeredFlightId).user_email;
        
        // Requester takes proposer's main flight
        db.prepare("UPDATE flights SET user_email = ? WHERE id = ?").run(requesterEmail, offeredFlightId);
        
        // Proposer takes requester's first flight
        db.prepare("UPDATE flights SET user_email = ? WHERE id = ?").run(proposerEmail, requesterFlights[0].id);

        // If proposer offered a return flight
        if (offeredReturnId && requesterFlights.length > 1) {
          db.prepare("UPDATE flights SET user_email = ? WHERE id = ?").run(requesterEmail, offeredReturnId);
          db.prepare("UPDATE flights SET user_email = ? WHERE id = ?").run(proposerEmail, requesterFlights[1].id);
        } else if (requesterFlights.length > 1) {
          // Proposer takes the rest of the group too? 
          // If it's a group, they usually go together.
          for (let i = 1; i < requesterFlights.length; i++) {
            db.prepare("UPDATE flights SET user_email = ? WHERE id = ?").run(proposerEmail, requesterFlights[i].id);
          }
        }
      } else {
        // Proposer is on Day Off, they take all requester flights
        for (const f of requesterFlights) {
          db.prepare("UPDATE flights SET user_email = ? WHERE id = ?").run(proposerEmail, f.id);
        }
      }

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
  const isProd = process.env.NODE_ENV === "production" || process.env.VITE_PROD === "true";
  
  if (!isProd) {
    console.log("Starting Vite in middleware mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    console.log("Serving static files from:", distPath);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.get("/api/debug", (req, res) => {
    try {
      const flights = db.prepare("SELECT COUNT(*) as count FROM flights").get() as any;
      const swaps = db.prepare("SELECT COUNT(*) as count FROM swap_requests").get() as any;
      const crew = db.prepare("SELECT COUNT(*) as count FROM annual_leaves").get() as any;
      const proposals = db.prepare("SELECT COUNT(*) as count FROM swap_proposals").get() as any;
      
      res.json({
        flights: flights.count,
        swaps: swaps.count,
        crew: crew.count,
        proposals: proposals.count,
        time: new Date().toISOString(),
        sqlite_time: db.prepare("SELECT datetime('now') as now").get()
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
