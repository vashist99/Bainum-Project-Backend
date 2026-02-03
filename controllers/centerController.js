import Center from "../models/Center.js";
import { Teacher } from "../models/User.js";

export const createCenter = async (req, res) => {
    try {
        const { name, address, phone, email, description } = req.body;

        // Validate required fields
        if (!name) {
            return res.status(400).json({ message: "Center name is required" });
        }

        // Check if center with this name already exists
        const existingCenter = await Center.findOne({ name });
        if (existingCenter) {
            return res.status(400).json({ message: "Center with this name already exists" });
        }

        // Create new center
        const center = new Center({
            name,
            address: address || "",
            phone: phone || "",
            email: email || "",
            description: description || "",
        });

        await center.save();

        res.status(201).json({
            message: "Center created successfully",
            center: {
                id: center._id,
                name: center.name,
                address: center.address,
                phone: center.phone,
                email: center.email,
                description: center.description,
            },
        });
    } catch (error) {
        console.error("Error creating center:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getAllCenters = async (req, res) => {
    try {
        const centers = await Center.find().sort({ name: 1 });
        res.status(200).json({ centers });
    } catch (error) {
        console.error("Error fetching centers:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getCenterById = async (req, res) => {
    try {
        const center = await Center.findById(req.params.id);
        if (!center) {
            return res.status(404).json({ message: "Center not found" });
        }
        res.status(200).json({ center });
    } catch (error) {
        console.error("Error fetching center:", error);
        res.status(500).json({ message: error.message });
    }
};

export const updateCenter = async (req, res) => {
    try {
        const { name, address, phone, email, description } = req.body;
        const { id } = req.params;

        // Validate required fields
        if (!name) {
            return res.status(400).json({ message: "Center name is required" });
        }

        // Check if center exists
        const center = await Center.findById(id);
        if (!center) {
            return res.status(404).json({ message: "Center not found" });
        }

        // Check if name is being changed and if new name already exists
        if (name !== center.name) {
            const existingCenter = await Center.findOne({ name });
            if (existingCenter) {
                return res.status(400).json({ message: "Center with this name already exists" });
            }
        }

        // Update center
        center.name = name;
        center.address = address || "";
        center.phone = phone || "";
        center.email = email || "";
        center.description = description || "";

        await center.save();

        res.status(200).json({
            message: "Center updated successfully",
            center: {
                id: center._id,
                name: center.name,
                address: center.address,
                phone: center.phone,
                email: center.email,
                description: center.description,
            },
        });
    } catch (error) {
        console.error("Error updating center:", error);
        res.status(500).json({ message: error.message });
    }
};

export const deleteCenter = async (req, res) => {
    try {
        const center = await Center.findByIdAndDelete(req.params.id);
        if (!center) {
            return res.status(404).json({ message: "Center not found" });
        }
        res.status(200).json({
            message: "Center deleted successfully",
            center: center
        });
    } catch (error) {
        console.error("Error deleting center:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getTeachersByCenter = async (req, res) => {
    try {
        const { centerName } = req.params;
        const teachers = await Teacher.find({ center: centerName });
        res.status(200).json({ teachers });
    } catch (error) {
        console.error("Error fetching teachers by center:", error);
        res.status(500).json({ message: error.message });
    }
};
