// import { Client } from "whatsapp-web.js";
// import qrcode from "qrcode-terminal";
// import express from "express";

// const app = express();

// const client = new Client({});

// client.once("ready", () => {
//   console.log("Bhaatsapp iz ready biraather!");
// });

// client.on("qr", (qr) => {
//   console.log("QR RECEIVED, HELL YEAA!", qr);
//   qrcode.generate(qr, { small: true });
// });

// client.on("message_create", (message) => {
//   console.log("---- Incoming Message Dude ----");
//   console.log({
//     id: message.id?._serialized, // unique message id
//     from: message.from, // sender jid
//     author: message.author, // if group message → actual sender
//     fromMe: message.fromMe, // was it sent by you?
//     to: message.to, // who it is targeted to
//     body: message.body, // message text
//     type: message.type, // chat, image, buttons, etc
//     hasMedia: message.hasMedia,
//     timestamp: message.timestamp, // unix seconds
//     isGroupMsg: !!message.author, // quick flag
//     mentionedIds: message.mentionedIds,
//     groupMentions: message.groupMentions,
//   });
//   if (message.body === "Kyu ree") {
//     // reply back "pong" directly to the message
//     message.reply("At the age of studying people are dying for ______");
//   }
//   if (message.body === "Hey") {
//     message.reply("Yea Yea Yea");
//   }
// });


// client.initialize();

// app.post('/qr', ()=> {

// })


// app.listen(3000, ()=> console.log("HTTP listening buddy"));



import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import express, { type Request,type Response } from "express";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";
// import cors from "cors";
import { fileURLToPath } from "url";
import { randomBytes } from 'node:crypto';
import chatbotRouter, { handleChatbotMessage } from './chatbot.js';
import { auth } from "./middleware/auth.js";
import dotenv from 'dotenv' ;

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// app.use(cors());
app.use(express.json());

// Mount chatbot routes
app.use('/api', chatbotRouter)

app.get("/yeaboi", auth, (req, res) => {
  res.json({"data": "INTERNAL POINTER VARIABLE"});
});
/**
 * Generates a random, unique, and short identifier.
 *
 * This function creates a cryptographically strong, URL-friendly ID.
 * It generates random bytes and encodes them as a hexadecimal string.
 *
 * @param length - The desired final length of the ID string. The default is 8.
 * @returns A string representing the unique ID.
 */
function generateUniqueId(length: number = 8): string {
  // Each byte of random data is represented by two hexadecimal characters.
  // So, we need to generate half the desired length in bytes.
  // Math.ceil is used to handle odd lengths.
  const byteLength = Math.ceil(length / 2);

  const buffer = randomBytes(byteLength); [5]
  
  // Convert the buffer to a hex string and slice to the desired length. [1, 3]
  return buffer.toString('hex').slice(0, length);
}

// Types
type Client = any;
type Message = any;

interface ClientData {
  client: Client;
  status: SessionStatus;
  qrCode?: string;
}

type SessionStatus =
  | "initializing"
  | "qr_ready"
  | "authenticated"
  | "ready"
  | "auth_failed"
  | "disconnected"
  | "not_initialized";

interface SessionInfo {
  userId: string;
  status: SessionStatus;
  isLoggedIn: boolean;
  lastActivity?: Date;
}

// Store for managing multiple WhatsApp clients
const clients = new Map<string, ClientData>();

const SESSIONS_DIR = path.join(__dirname, ".wwebjs_auth");
const SESSION_METADATA_FILE = path.join(__dirname, "sessions_metadata.json");

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Session metadata management
interface SessionMetadata {
  userId: string;
  lastActivity: string;
  status: SessionStatus;
}

function loadSessionMetadata(): SessionMetadata[] {
  try {
    if (fs.existsSync(SESSION_METADATA_FILE)) {
      const data = fs.readFileSync(SESSION_METADATA_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading session metadata:", error);
  }
  return [];
}

function saveSessionMetadata() {
  try {
    const metadata: SessionMetadata[] = Array.from(clients.entries()).map(
      ([userId, data]) => ({
        userId,
        lastActivity: new Date().toISOString(),
        status: data.status,
      })
    );
    fs.writeFileSync(SESSION_METADATA_FILE, JSON.stringify(metadata, null, 2));
  } catch (error) {
    console.error("Error saving session metadata:", error);
  }
}

// Load existing sessions on startup
async function loadExistingSessions() {
  try {
    console.log("Loading existing sessions...");
    const metadata = loadSessionMetadata();

    if (fs.existsSync(SESSIONS_DIR)) {
      const sessions = fs.readdirSync(SESSIONS_DIR);
      console.log(`Found ${sessions.length} session directories`);

      for (const sessionDir of sessions) {
        const sessionPath = path.join(SESSIONS_DIR, sessionDir);
        if (fs.statSync(sessionPath).isDirectory()) {
          // Extract userId from session directory name (format: session-userId)
          const userId = sessionDir.replace("session-", "");
          console.log(`Restoring session for user: ${userId}`);
          await initializeClient(userId);
        }
      }
    }

    console.log(`Loaded ${clients.size} existing sessions`);
  } catch (error) {
    console.error("Error loading existing sessions:", error);
  }
}

// Initialize a WhatsApp client for a user
async function initializeClient(userId: string): Promise<Client> {
  if (clients.has(userId)) {
    const existing = clients.get(userId)!;
    console.log(`Client already exists for ${userId} with status: ${existing.status}`);
    return existing.client;
  }

  console.log(`Initializing new client for user: ${userId}`);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: userId,
      dataPath: SESSIONS_DIR,
    }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    },
  });

  const clientData: ClientData = {
    client,
    status: "initializing",
  };

  clients.set(userId, clientData);

  client.on("qr", async (qr: string) => {
    console.log(`QR received for user ${userId}`);
    try {
      const qrDataUrl = await QRCode.toDataURL(qr);
      const data = clients.get(userId);
      if (data) {
        data.qrCode = qrDataUrl;
        data.status = "qr_ready";
        saveSessionMetadata();
      }
    } catch (err) {
      console.error(`QR generation failed for ${userId}:`, err);
    }
  });

  client.on("ready", () => {
    console.log(`✅ Client ready for user ${userId}`);
    const data = clients.get(userId);
    if (data) {
      data.status = "ready";
      data.qrCode = "undefined";
      saveSessionMetadata();
    }
  });

  client.on("authenticated", () => {
    console.log(`✅ Client authenticated for user ${userId}`);
    const data = clients.get(userId);
    if (data) {
      data.status = "authenticated";
      saveSessionMetadata();
    }
  });

  client.on("auth_failure", (msg: string) => {
    console.error(`❌ Auth failure for user ${userId}:`, msg);
    const data = clients.get(userId);
    if (data) {
      data.status = "auth_failed";
      data.qrCode = "undefined";
      saveSessionMetadata();
    }
  });

  client.on("disconnected", (reason: string) => {
    console.log(`⚠️ Client disconnected for user ${userId}:`, reason);
    const data = clients.get(userId);
    if (data) {
      data.status = "disconnected";
    }
    const currentClient = clients.get(userId);
    currentClient?.client.destroy();
    clients.delete(userId);
    saveSessionMetadata();
  });

  client.on("message_create", async (message: any) => {
    // console.log(`📨 Message from ${userId}:`, {
    //   from: message.from,
    //   body: message.body,
    // });

        // Handle chatbot response
    await handleChatbotMessage(userId, message, client);
  });

  await client.initialize();
  console.log(`Client initialization started for ${userId}`);

  return client;
}

// Middleware to check if client exists and is ready
function requireAuth(req: Request, res: Response, next: Function) {
  const userId = req.body.userId || req.params.userId;

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  const clientData = clients.get(userId);

  if (!clientData) {
    return res.status(401).json({
      error: "Session not found. Please log in first.",
      needsLogin: true,
    });
  }

  if (clientData.status !== "ready") {
    return res.status(401).json({
      error: "WhatsApp not connected. Please log in first.",
      needsLogin: true,
      currentStatus: clientData.status,
    });
  }

  next();
}

// API Endpoints

// Initialize a new WhatsApp session
app.post("/api/session/init", async (req: Request, res: Response) => {
  try {
    // const { userId } = req.body;
    const userId = generateUniqueId();

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const clientData = clients.get(userId);

    if (clientData && clientData.status === "ready") {
      return res.json({
        message: "Session already active",
        status: "ready",
        userId,
      });
    }

    await initializeClient(userId);
    const newClientData = clients.get(userId)!;

    res.json({
      message: "Session initialization started",
      userId,
      status: newClientData.status,
    });
  } catch (error: any) {
    console.error("Init error:", error);
    res.status(500).json({
      error: "Failed to initialize session",
      details: error.message,
    });
  }
});

// Get QR code for scanning
app.get("/api/session/qr/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const clientData = clients.get(userId!);

    if (!clientData) {
      return res.status(404).json({
        error: "Session not found. Please initialize first.",
        needsLogin: true,
      });
    }

    if (clientData.status === "ready") {
      return res.json({
        message: "Already logged in",
        status: "ready",
      });
    }

    if (!clientData.qrCode) {
      return res.json({
        message: "Waiting for QR code...",
        status: clientData.status,
      });
    }
    console.error("Fetched QR for userId: ", userId);

    res.json({
      qrCode: clientData.qrCode,
      status: "qr_ready",
    });
  } catch (error: any) {
    console.error("QR fetch error:", error);
    res.status(500).json({
      error: "Failed to fetch QR code",
      details: error.message,
    });
  }
});

// Check session status
app.get("/api/session/status/:userId", (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const clientData = clients.get(userId!);

    if (!clientData) {
      return res.json({
        status: "not_initialized" as SessionStatus,
        isLoggedIn: false,
        needsLogin: true,
      });
    }

    const isLoggedIn = clientData.status === "ready";

    res.json({
      status: clientData.status,
      isLoggedIn,
      needsLogin: !isLoggedIn,
    });
  } catch (error: any) {
    console.error("Status check error:", error);
    res.status(500).json({
      error: "Failed to check status",
      details: error.message,
    });
  }
});

// Logout and destroy session
app.post("/api/session/logout", async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const clientData = clients.get(userId);

    if (!clientData) {
      return res.status(404).json({ error: "Session not found" });
    }

    await clientData.client.logout();
    await clientData.client.destroy();
    clients.delete(userId);

    // Delete session files
    const sessionPath = path.join(SESSIONS_DIR, `session-${userId}`);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    saveSessionMetadata();

    res.json({ message: "Logged out successfully", userId });
  } catch (error: any) {
    console.error("Logout error:", error);
    res.status(500).json({
      error: "Logout failed",
      details: error.message,
    });
  }
});

// Send text message
app.post("/api/message/send", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        error: "phone and message are required",
      });
    }

    const clientData = clients.get(userId)!;


    let digits = phone.replace(/\D/g, "");

    // If it's a 10-digit Indian number, prepend country code 91
    if (digits.length === 10) {
      digits = "91" + digits;
    }

    // Format phone number (country code + number without + or spaces)
    const chatId = digits + "@c.us";
    const sentMessage = await clientData.client.sendMessage(chatId, message);
  
    res.json({
      success: true,
      message: "Message sent successfully",
      messageId: sentMessage.id._serialized,
      timestamp: sentMessage.timestamp,
    });
  } catch (error: any) {
    console.error("Send message error:", error);
    res.status(500).json({
      error: "Failed to send message",
      details: error.message,
    });
  }
});

app.post("/api/message/send-many", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, phones, message } = req.body;

    if (!phones || !message) {
      return res.status(400).json({
        error: "phone and message are required",
      });
    }

    const clientData = clients.get(userId)!;
    const sentMessagesPromiseArr: Promise<any>[] = [];
    phones.forEach((item: String)=> {
      const chatId = item.replace(/[^\d]/g, "") + "@c.us";
      const sentMessagePromise: Promise<any> = clientData.client.sendMessage(chatId, message)
      sentMessagesPromiseArr.push(sentMessagePromise);
    })
    // Format phone number (country code + number without + or spaces)
    Promise.allSettled(sentMessagesPromiseArr).then(
      (results)=> {
        console.log(results);
      }
    ).catch((e)=> {
      console.log("Error occured in send-many route")
    })

    res.json({
      success: true,
    });
  } catch (error: any) {
    console.error("Send message error:", error);
    res.status(500).json({
      error: "Failed to send message",
      details: error.message,
    });
  }
});

app.post("/api/message/send-many-image", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, phones, message , imageUrl} = req.body;

    if (!phones || !message) {
      return res.status(400).json({
        error: "phone and message are required",
      });
    }

    const clientData = clients.get(userId)!;
    const sentMessagesPromiseArr: Promise<any>[] = [];

        // Fetch image and convert to base64
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeType = response.headers.get("content-type") || "image/jpeg";

    const media = new MessageMedia(mimeType, base64);
  

    phones.forEach((item: String)=> {
      const chatId = item.replace(/[^\d]/g, "") + "@c.us";
      const sentMessagePromise: Promise<any> = clientData.client.sendMessage(chatId, media, {
        caption: message || "",
      });
      sentMessagesPromiseArr.push(sentMessagePromise);
    });
    // Format phone number (country code + number without + or spaces)
    Promise.allSettled(sentMessagesPromiseArr).then(
      (results)=> {
        console.log(results);
      }
    ).catch((e)=> {
      console.log("Error occured in send-many route")
    })

    res.json({
      success: true,
    });
  } catch (error: any) {
    console.error("Send message error:", error);
    res.status(500).json({
      error: "Failed to send message",
      details: error.message,
    });
  }
});


// Send message with image
app.post("/api/message/send-media", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, phone, caption, imageUrl } = req.body;

    if (!phone || !imageUrl) {
      return res.status(400).json({
        error: "phone and imageUrl are required",
      });
    }

    const clientData = clients.get(userId)!;
    const chatId = phone.replace(/[^\d]/g, "") + "@c.us";

    // Fetch image and convert to base64
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeType = response.headers.get("content-type") || "image/jpeg";

    const media = new MessageMedia(mimeType, base64);
    const sentMessage = await clientData.client.sendMessage(chatId, media, {
      caption: caption || "",
    });

    res.json({
      success: true,
      message: "Media sent successfully",
      messageId: sentMessage.id._serialized,
      timestamp: sentMessage.timestamp,
    });
  } catch (error: any) {
    console.error("Send media error:", error);
    res.status(500).json({
      error: "Failed to send media",
      details: error.message,
    });
  }
});

// Get all active sessions
app.get("/api/sessions", (req: Request, res: Response) => {
  try {
    const sessions: SessionInfo[] = Array.from(clients.entries()).map(
      ([userId, data]) => ({
        userId,
        status: data.status,
        isLoggedIn: data.status === "ready",
      })
    );

    res.json({
      sessions,
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => s.isLoggedIn).length,
    });
  } catch (error: any) {
    console.error("Sessions list error:", error);
    res.status(500).json({
      error: "Failed to fetch sessions",
      details: error.message,
    });
  }
});

// Health check
app.get("/api/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    activeSessions: clients.size,
    timestamp: new Date().toISOString(),
  });
});

// Test endpoint to check if server is responding
app.get("/", (req: Request, res: Response) => {
  res.json({
    name: "WhatsApp Multi-Account API",
    version: "1.0.0",
    endpoints: [
      "POST /api/session/init",
      "GET /api/session/qr/:userId",
      "GET /api/session/status/:userId",
      "POST /api/session/logout",
      "POST /api/message/send",
      "POST /api/message/send-media",
      "GET /api/sessions",
      "GET /api/health",
      "--- CHATBOT ENDPOINTS ---",
      "POST /api/chatbot",
      "GET /api/chatbot/:userId",
      "POST /api/chatbot/option",
      "DELETE /api/chatbot/option/:userId/:optionKey",
      "PATCH /api/chatbot/:userId/toggle",
      "DELETE /api/chatbot/:userId",
    ],
  });
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  saveSessionMetadata();

  for (const [userId, data] of clients.entries()) {
    try {
      console.log(`Closing client for ${userId}`);
      await data.client.destroy();
    } catch (error) {
      console.error(`Error closing client ${userId}:`, error);
    }
  }

  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3456;

app.listen(PORT, async () => {
  console.log(`\n🚀 WhatsApp API Server running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`\n📁 Sessions directory: ${SESSIONS_DIR}`);
  console.log(`📄 Metadata file: ${SESSION_METADATA_FILE}\n`);

  // Load existing sessions after server starts
  await loadExistingSessions();

  console.log(`\n✅ Server ready to accept connections\n`);
});