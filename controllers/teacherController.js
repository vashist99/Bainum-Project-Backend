import { Teacher } from "../models/User.js";
import crypto from "crypto";
import bcrypt from "bcrypt";

/**
 * Generate a random default password
 * Format: 8 random alphanumeric characters
 */
const generateDefaultPassword = () => {
    // Generate 8 random bytes and convert to base64, then take first 8 characters
    // This ensures a mix of letters and numbers
    const randomBytes = crypto.randomBytes(6);
    const base64 = randomBytes.toString('base64');
    // Remove special characters and take first 8 alphanumeric characters
    const alphanumeric = base64.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
    // Ensure it's at least 8 characters by padding if needed
    return alphanumeric.padEnd(8, '0') + Math.floor(Math.random() * 10);
};

/** Validate username format: 3-30 chars, lowercase alphanumeric + underscore */
const validateUsername = (u) => /^[a-z0-9_]{3,30}$/.test((u || '').toLowerCase().trim());

export const createTeacher = async (req, res) => {
    try {
        const { name, email, password, center, education, dateOfBirth, username } = req.body;

        // Validate required fields (password is now optional)
        if (!name || !email || !center || !education || !dateOfBirth) {
            return res.status(400).json({ message: "All fields except password are required" });
        }

        if (!username || !validateUsername(username)) {
            return res.status(400).json({ message: "Username is required (3-30 chars, lowercase letters, numbers, underscore only)" });
        }

        const cleanUsername = username.toLowerCase().trim();

        // Check if username is already taken
        const existingByUsername = await Teacher.findOne({ username: cleanUsername });
        if (existingByUsername) {
            return res.status(400).json({ message: "Username is already taken" });
        }

        // Validate teacher age must be 21 or above
        const dob = new Date(dateOfBirth);
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 21);
        if (isNaN(dob.getTime()) || dob > cutoff) {
            return res.status(400).json({ message: "Teacher must be 21 years or older" });
        }

        // Check if teacher with this email already exists
        const existingTeacher = await Teacher.findOne({ email });
        if (existingTeacher) {
            return res.status(400).json({ message: "Teacher with this email already exists" });
        }

        // Generate default password if not provided
        const teacherPassword = password || generateDefaultPassword();

        // Hash password before saving
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(teacherPassword, saltRounds);

        // Create new teacher
        const teacher = new Teacher({
            name,
            email,
            username: cleanUsername,
            role: "teacher",
            password: hashedPassword,
            center,
            education,
            dateOfBirth,
        });

        await teacher.save();

        res.status(201).json({
            message: "Teacher created successfully",
            teacher: {
                id: teacher._id,
                name: teacher.name,
                email: teacher.email,
                role: teacher.role,
                center: teacher.center,
                education: teacher.education,
                dateOfBirth: teacher.dateOfBirth,
            },
            // Include default password in response if one was generated
            ...(password ? {} : { defaultPassword: teacherPassword }),
        });
    } catch (error) {
        console.error("Error creating teacher:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getAllTeachers = async (req, res) => {
    try {
        const teachers = await Teacher.find();
        res.status(200).json({ teachers });
    } catch (error) {
        console.error("Error fetching teachers:", error);
        res.status(500).json({ message: error.message });
    }
};

/** Check if string looks like MongoDB ObjectId (24 hex chars) */
const isObjectId = (s) => /^[a-fA-F0-9]{24}$/.test(s);

export const getTeacherById = async (req, res) => {
    try {
        const { id } = req.params;
        const teacher = isObjectId(id)
            ? await Teacher.findById(id)
            : await Teacher.findOne({ username: id.toLowerCase().trim() });
        if (!teacher) {
            return res.status(404).json({ message: "Teacher not found" });
        }
        res.status(200).json({ teacher });
    } catch (error) {
        console.error("Error fetching teacher:", error);
        res.status(500).json({ message: error.message });
    }
};

export const updateTeacher = async (req, res) => {
    try {
        const { name, email, center, education, dateOfBirth, username } = req.body;
        const { id } = req.params;

        // Validate required fields
        if (!name || !email || !center || !education || !dateOfBirth) {
            return res.status(400).json({ message: "All fields are required" });
        }

        // Validate teacher age must be 21 or above
        const dob = new Date(dateOfBirth);
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 21);
        if (isNaN(dob.getTime()) || dob > cutoff) {
            return res.status(400).json({ message: "Teacher must be 21 years or older" });
        }

        // Check if teacher exists (by id or username)
        const teacher = isObjectId(id)
            ? await Teacher.findById(id)
            : await Teacher.findOne({ username: id.toLowerCase().trim() });
        if (!teacher) {
            return res.status(404).json({ message: "Teacher not found" });
        }

        // Check if email is being changed and if new email already exists
        if (email !== teacher.email) {
            const existingTeacher = await Teacher.findOne({ email });
            if (existingTeacher) {
                return res.status(400).json({ message: "Teacher with this email already exists" });
            }
        }

        // Update username if provided and valid
        if (username !== undefined) {
            if (!validateUsername(username)) {
                return res.status(400).json({ message: "Username must be 3-30 chars, lowercase letters, numbers, underscore only" });
            }
            const cleanUsername = username.toLowerCase().trim();
            if (cleanUsername !== (teacher.username || '')) {
                const existingByUsername = await Teacher.findOne({ username: cleanUsername });
                if (existingByUsername) {
                    return res.status(400).json({ message: "Username is already taken" });
                }
                teacher.username = cleanUsername;
            }
        }

        // Update teacher
        teacher.name = name;
        teacher.email = email;
        teacher.center = center;
        teacher.education = education;
        teacher.dateOfBirth = dateOfBirth;

        await teacher.save();

        res.status(200).json({
            message: "Teacher updated successfully",
            teacher: {
                id: teacher._id,
                name: teacher.name,
                email: teacher.email,
                username: teacher.username,
                role: teacher.role,
                center: teacher.center,
                education: teacher.education,
                dateOfBirth: teacher.dateOfBirth,
            },
        });
    } catch (error) {
        console.error("Error updating teacher:", error);
        res.status(500).json({ message: error.message });
    }
};

export const deleteTeacher = async (req, res) => {
    try {
        const { id } = req.params;
        const found = isObjectId(id)
            ? await Teacher.findById(id)
            : await Teacher.findOne({ username: id.toLowerCase().trim() });
        if (!found) {
            return res.status(404).json({ message: "Teacher not found" });
        }
        const teacher = await Teacher.findByIdAndDelete(found._id);
        if (!teacher) {
            return res.status(404).json({ message: "Teacher not found" });
        }
        res.status(200).json({
            message: "Teacher deleted successfully",
            teacher: teacher
        });
    } catch (error) {
        console.error("Error deleting teacher:", error);
        res.status(500).json({ message: error.message });
    }
};

