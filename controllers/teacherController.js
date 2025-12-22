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

export const createTeacher = async (req, res) => {
    try {
        const { name, email, password, center, education, dateOfBirth } = req.body;

        // Validate required fields (password is now optional)
        if (!name || !email || !center || !education || !dateOfBirth) {
            return res.status(400).json({ message: "All fields except password are required" });
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

export const getTeacherById = async (req, res) => {
    try {
        const teacher = await Teacher.findById(req.params.id);
        if (!teacher) {
            return res.status(404).json({ message: "Teacher not found" });
        }
        res.status(200).json({ teacher });
    } catch (error) {
        console.error("Error fetching teacher:", error);
        res.status(500).json({ message: error.message });
    }
};

export const deleteTeacher = async (req, res) => {
    try {
        const teacher = await Teacher.findByIdAndDelete(req.params.id);
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

