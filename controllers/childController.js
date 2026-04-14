import { Child, Teacher } from "../models/User.js";
import { hasActiveTeacherChildGrant } from "../lib/accessGrantHelpers.js";

export const createChild = async (req, res) => {
    try {
        const { name, dateOfBirth, gender, diagnosis, primaryLanguage, leadTeacher } = req.body;

        // Validate required fields
        if (!name || !dateOfBirth || !gender || !diagnosis || !primaryLanguage || !leadTeacher) {
            return res.status(400).json({ message: "All fields are required" });
        }

        // Validate child age must be 8 years or below
        const dob = new Date(dateOfBirth);
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 8);
        if (isNaN(dob.getTime()) || dob < cutoff) {
            return res.status(400).json({ message: "Child must be 8 years old or younger" });
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
        const user = req.user;
        if (user?.role === "admin") {
            const children = await Child.find();
            return res.status(200).json({ children });
        }
        if (user?.role === "teacher") {
            const teacher = await Teacher.findById(user.id);
            if (!teacher) {
                return res.status(200).json({ children: [] });
            }
            // List all children assigned to this lead teacher (for invites). Full child page still requires AccessGrant.
            const children = await Child.find({ leadTeacher: teacher.name });
            return res.status(200).json({ children });
        }
        if (user?.role === "parent" && user.childId) {
            const children = await Child.find({ _id: user.childId });
            return res.status(200).json({ children });
        }
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

        if (req.user && req.user.role === 'parent' && req.user.childId) {
            const userChildId = req.user.childId.toString();
            const childId = child._id.toString();
            
            if (userChildId !== childId) {
                return res.status(403).json({ message: "You don't have access to this child's data" });
            }
        }

        if (req.user?.role === "teacher") {
            const teacher = await Teacher.findById(req.user.id);
            const hasGrant = await hasActiveTeacherChildGrant(req.user.id, child._id);
            if (hasGrant) {
                return res.status(200).json({ child });
            }
            const isLead = teacher && child.leadTeacher === teacher.name;
            if (isLead) {
                return res.status(403).json({
                    code: "TEACHER_ACCESS_DENIED",
                    message:
                        "The parent must accept your invitation (or approve access) before you can view this child's full data. You can send an invitation to the parent's email below.",
                    child: {
                        _id: child._id,
                        name: child.name,
                        leadTeacher: child.leadTeacher,
                    },
                });
            }
            return res.status(403).json({ message: "You do not have access to this child's data" });
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

        // Validate child age must be 8 years or below
        const dob = new Date(dateOfBirth);
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 8);
        if (isNaN(dob.getTime()) || dob < cutoff) {
            return res.status(400).json({ message: "Child must be 8 years old or younger" });
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
