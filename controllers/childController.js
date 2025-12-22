import { Child } from "../models/User.js";
import { parentChildAccess } from "../middleware/parentChildAccess.js";

export const createChild = async (req, res) => {
    try {
        const { name, dateOfBirth, gender, diagnosis, primaryLanguage, leadTeacher } = req.body;

        // Validate required fields
        if (!name || !dateOfBirth || !gender || !diagnosis || !primaryLanguage || !leadTeacher) {
            return res.status(400).json({ message: "All fields are required" });
        }

        // Create new child
        const child = new Child({
            name,
            role: "child",
            dateOfBirth,
            gender,
            diagnosis,
            primaryLanguage,
            leadTeacher,
        });

        await child.save();

        res.status(201).json({
            message: "Child created successfully",
            child: {
                id: child._id,
                name: child.name,
                role: child.role,
                dateOfBirth: child.dateOfBirth,
                gender: child.gender,
                diagnosis: child.diagnosis,
                primaryLanguage: child.primaryLanguage,
                leadTeacher: child.leadTeacher,
            },
        });
    } catch (error) {
        console.error("Error creating child:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getAllChildren = async (req, res) => {
    try {
        const children = await Child.find();
        res.status(200).json({ children });
    } catch (error) {
        console.error("Error fetching children:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getChildById = async (req, res) => {
    try {
        const child = await Child.findById(req.params.id).populate('parents', 'name email');
        
        if (!child) {
            return res.status(404).json({ message: "Child not found" });
        }

        // If user is a parent, verify they have access to this child
        await parentChildAccess(req, res, next);
        
        res.status(200).json({ child });
    } catch (error) {
        console.error("Error fetching child:", error);
        res.status(500).json({ message: error.message });
    }
};

