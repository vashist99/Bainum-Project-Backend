import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

// Load environment variables FIRST before importing anything that uses them
dotenv.config();

// Now import modules that depend on environment variables
import rateLimiter from "../middleware/rateLimiter.js";
import connectDB from "../config/db.js";
import authRoutes from "../routes/authRoutes.js";
import childRoutes from "../routes/childRoutes.js";
import teacherRoutes from "../routes/teacherRoutes.js";
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
// Remove trailing slashes from URLs for proper matching
const whitelist = [
  "https://bainum-project-saf2.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000"
];

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
      console.log(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(rateLimiter);

// Health check endpoint
app.get("/", (req, res) => {
    res.json({ message: "Bainum Project API is running!", status: "OK" });
});

app.use("/api/auth", authRoutes);
app.use("/api/children", childRoutes);
app.use("/api/teachers", teacherRoutes);
app.use("/api/notes", noteRoutes);
app.use("/api", whisperRoutes);
app.use("/api/invitations", invitationRoutes);
app.use("/api/teacher-invitations", teacherInvitationRoutes);

app.listen(process.env.PORT, () => {
    console.log(`Server is running on port ${process.env.PORT}`);
});