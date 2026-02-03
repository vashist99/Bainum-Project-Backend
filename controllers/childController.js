import { Child } from "../models/User.js";

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
        // The parentChildAccess middleware should be applied in the route, not here
        // But we can also check here as a safety measure
        if (req.user && req.user.role === 'parent' && req.user.childId) {
            const userChildId = req.user.childId.toString();
            const childId = child._id.toString();
            
            if (userChildId !== childId) {
                return res.status(403).json({ message: "You don't have access to this child's data" });
            }
        }
        
        res.status(200).json({ child });
    } catch (error) {
        console.error("Error fetching child:", error);
        res.status(500).json({ message: error.message });
    }
};

export const updateChild = async (req, res) => {
    try {
        const { name, dateOfBirth, gender, diagnosis, primaryLanguage, leadTeacher } = req.body;
        const { id } = req.params;

        // Validate required fields
        if (!name || !dateOfBirth || !gender || !diagnosis || !primaryLanguage || !leadTeacher) {
            return res.status(400).json({ message: "All fields are required" });
        }

        // Check if child exists
        const child = await Child.findById(id);
        if (!child) {
            return res.status(404).json({ message: "Child not found" });
        }

        // Update child
        child.name = name;
        child.dateOfBirth = dateOfBirth;
        child.gender = gender;
        child.diagnosis = diagnosis;
        child.primaryLanguage = primaryLanguage;
        child.leadTeacher = leadTeacher;

        await child.save();

        res.status(200).json({
            message: "Child updated successfully",
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
        console.error("Error updating child:", error);
        res.status(500).json({ message: error.message });
    }
};

export const deleteChild = async (req, res) => {
    try {
        const child = await Child.findByIdAndDelete(req.params.id);
        if (!child) {
            return res.status(404).json({ message: "Child not found" });
        }
        res.status(200).json({
            message: "Child deleted successfully",
            child: child
        });
    } catch (error) {
        console.error("Error deleting child:", error);
        res.status(500).json({ message: error.message });
    }
};
