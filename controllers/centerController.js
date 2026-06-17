import Center from "../models/Center.js";
import { Teacher } from "../models/User.js";
import {
    formatSchoolRegistryEntity,
    mapSchoolRegistryCollection,
    mapSchoolCollection,
    schoolEntityKey,
    schoolListKey,
} from "../lib/schoolFieldAlias.js";

export const createCenter = async (req, res) => {
    try {
        const { name, address, phone, email, description } = req.body;

        if (!name) {
            return res.status(400).json({ message: "School name is required" });
        }

        const existingCenter = await Center.findOne({ name });
        if (existingCenter) {
            return res.status(400).json({ message: "School with this name already exists" });
        }

        const center = new Center({
            name,
            address: address || "",
            phone: phone || "",
            email: email || "",
            description: description || "",
        });

        await center.save();

        const entityKey = schoolEntityKey(req);
        res.status(201).json({
            message: "School created successfully",
            [entityKey]: formatSchoolRegistryEntity(center),
        });
    } catch (error) {
        console.error("Error creating school:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getAllCenters = async (req, res) => {
    try {
        const centers = await Center.find().sort({ name: 1 });
        const listKey = schoolListKey(req);
        res.status(200).json({ [listKey]: mapSchoolRegistryCollection(centers) });
    } catch (error) {
        console.error("Error fetching schools:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getCenterById = async (req, res) => {
    try {
        const center = await Center.findById(req.params.id);
        if (!center) {
            return res.status(404).json({ message: "School not found" });
        }
        const entityKey = schoolEntityKey(req);
        res.status(200).json({ [entityKey]: formatSchoolRegistryEntity(center) });
    } catch (error) {
        console.error("Error fetching school:", error);
        res.status(500).json({ message: error.message });
    }
};

export const updateCenter = async (req, res) => {
    try {
        const { name, address, phone, email, description } = req.body;
        const { id } = req.params;

        if (!name) {
            return res.status(400).json({ message: "School name is required" });
        }

        const center = await Center.findById(id);
        if (!center) {
            return res.status(404).json({ message: "School not found" });
        }

        if (name !== center.name) {
            const existingCenter = await Center.findOne({ name });
            if (existingCenter) {
                return res.status(400).json({ message: "School with this name already exists" });
            }
        }

        center.name = name;
        center.address = address || "";
        center.phone = phone || "";
        center.email = email || "";
        center.description = description || "";

        await center.save();

        const entityKey = schoolEntityKey(req);
        res.status(200).json({
            message: "School updated successfully",
            [entityKey]: formatSchoolRegistryEntity(center),
        });
    } catch (error) {
        console.error("Error updating school:", error);
        res.status(500).json({ message: error.message });
    }
};

export const deleteCenter = async (req, res) => {
    try {
        const center = await Center.findByIdAndDelete(req.params.id);
        if (!center) {
            return res.status(404).json({ message: "School not found" });
        }
        const entityKey = schoolEntityKey(req);
        res.status(200).json({
            message: "School deleted successfully",
            [entityKey]: formatSchoolRegistryEntity(center),
        });
    } catch (error) {
        console.error("Error deleting school:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getTeachersByCenter = async (req, res) => {
    try {
        const { centerName } = req.params;
        const teachers = await Teacher.find({ center: centerName });
        res.status(200).json({ teachers: mapSchoolCollection(teachers) });
    } catch (error) {
        console.error("Error fetching teachers by school:", error);
        res.status(500).json({ message: error.message });
    }
};
