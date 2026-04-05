// Must be first: ESM evaluates imports before this file's body, so a bare
// dotenv.config() below would run too late. Load backend/.env by path regardless of cwd.
import "../config/loadEnv.js";

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

import rateLimiter from "../middleware/rateLimiter.js";
import connectDB from "../config/db.js";
import authRoutes from "../routes/authRoutes.js";
import childRoutes from "../routes/childRoutes.js";
import teacherRoutes from "../routes/teacherRoutes.js";
import centerRoutes from "../routes/centerRoutes.js";
import noteRoutes from "../routes/noteRoutes.js";
import whisperRoutes from "../routes/whisperRoutes.js";
import invitationRoutes from "../routes/invitationRoutes.js";
import teacherInvitationRoutes from "../routes/teacherInvitationRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Connect to database
connectDB();

//middleware
// CORS configuration
// Build allowed origins list from environment variables
const buildAllowedOrigins = () => {
  const allowedOrigins = [];
  
  // Parse ALLOWED_ORIGINS from environment (comma-separated)
  if (process.env.ALLOWED_ORIGINS) {
    const origins = process.env.ALLOWED_ORIGINS.split(',').map(url => url.trim());
    allowedOrigins.push(...origins);
  }
  
  // Fallback to FRONTEND_URL if ALLOWED_ORIGINS is not set
  if (allowedOrigins.length === 0 && process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL);
  }
  
  // Always include localhost origins for development
  const localhostOrigins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000"
  ];
  
  // Add localhost origins if not already present
  localhostOrigins.forEach(origin => {
    if (!allowedOrigins.includes(origin)) {
      allowedOrigins.push(origin);
    }
  });
  
  // Remove trailing slashes from all URLs for proper matching
  return allowedOrigins.map(url => url.replace(/\/$/, ''));
};

const whitelist = buildAllowedOrigins();

const corsOptions = { 
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    // Remove trailing slash from origin for comparison
    const originWithoutSlash = origin.replace(/\/$/, '');
    
    // Check if origin is in whitelist
    if (whitelist.includes(originWithoutSlash)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

// Apply CORS middleware FIRST, before any other middleware
// The cors middleware already handles OPTIONS requests automatically
app.use(cors(corsOptions));

app.use(express.json());
app.use(rateLimiter);

// Health check endpoints (Render pings /health; logs visible in Render dashboard)
app.get("/", (req, res) => {
    res.json({ message: "Bainum Project API is running!", status: "OK" });
});

app.get("/health", (req, res) => {
    const ragEnabled = process.env.RAG_ENABLED?.toString().toLowerCase().trim() === "true";
    const openaiKeySet = !!process.env.OPENAI_API_KEY;
    const revaiKeySet = !!process.env.REVAI_API_KEY;
    const health = {
        status: "OK",
        rag: {
            enabled: ragEnabled,
            openaiKeySet
        },
        revaiKeySet
    };
    console.log("[Health] RAG_ENABLED:", ragEnabled, "OPENAI_API_KEY set:", openaiKeySet, "REVAI_API_KEY set:", revaiKeySet);
    res.status(200).json(health);
});

app.use("/api/auth", authRoutes);
app.use("/api/children", childRoutes);
app.use("/api/teachers", teacherRoutes);
app.use("/api/centers", centerRoutes);
app.use("/api/notes", noteRoutes);
app.use("/api", whisperRoutes);
app.use("/api/invitations", invitationRoutes);
app.use("/api/teacher-invitations", teacherInvitationRoutes);

app.listen(process.env.PORT, () => {
    console.log(`Server is running on port ${process.env.PORT}`);
});