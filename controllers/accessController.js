import mongoose from "mongoose";
import AccessGrant from "../models/AccessGrant.js";
import { Parent, Teacher } from "../models/User.js";
import {
    getResolvedChildIdStringsForParent,
    parentMayAccessChild,
} from "../lib/parentChildHelpers.js";

/**
 * Parent requests permission to view a teacher's data (for their child).
 * POST body: { teacherId, childId }
 */
export const requestTeacherAccessFromParent = async (req, res) => {
    try {
        const { teacherId, childId } = req.body;
        const user = req.user;

        if (!user || user.role !== "parent") {
            return res.status(403).json({ message: "Only parents can request teacher access" });
        }
        if (!teacherId || !childId) {
            return res.status(400).json({ message: "teacherId and childId are required" });
        }

        const parent = await Parent.findById(user.id);
        if (!parent || !(await parentMayAccessChild(parent, childId))) {
            return res.status(403).json({ message: "childId must be one of your linked children" });
        }

        const teacher = await Teacher.findById(teacherId);
        if (!teacher) {
            return res.status(404).json({ message: "Teacher not found" });
        }

        const existing = await AccessGrant.findOne({
            childId,
            teacherId,
            parentId: parent._id,
        });

        if (existing?.status === "active") {
            return res.status(400).json({ message: "Access is already active for this teacher and child" });
        }
        if (existing?.status === "pending") {
            return res.status(400).json({ message: "A pending request already exists" });
        }

        const grant = await AccessGrant.create({
            childId,
            teacherId,
            parentId: parent._id,
            status: "pending",
            initiatedBy: "parent",
        });

        res.status(201).json({
            message: "Request sent. The teacher must approve before you can view their data.",
            grant,
        });
    } catch (error) {
        console.error("requestTeacherAccessFromParent:", error);
        if (error.code === 11000) {
            return res.status(400).json({ message: "A grant record already exists for this pair" });
        }
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/**
 * Teacher approves a parent's request to view teacher data.
 */
export const approveParentAccessRequest = async (req, res) => {
    try {
        const { grantId } = req.params;
        const user = req.user;

        if (!user || user.role !== "teacher") {
            return res.status(403).json({ message: "Only teachers can approve these requests" });
        }

        if (!mongoose.Types.ObjectId.isValid(grantId)) {
            return res.status(400).json({ message: "Invalid grant id" });
        }

        const grant = await AccessGrant.findById(grantId);
        if (!grant) {
            return res.status(404).json({ message: "Request not found" });
        }

        if (grant.teacherId.toString() !== String(user.id)) {
            return res.status(403).json({ message: "This request is not for you" });
        }

        if (grant.status !== "pending" || grant.initiatedBy !== "parent") {
            return res.status(400).json({ message: "This request cannot be approved" });
        }

        grant.status = "active";
        await grant.save();

        res.status(200).json({ message: "Access approved", grant });
    } catch (error) {
        console.error("approveParentAccessRequest:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/**
 * List pending requests for the current teacher (parent-initiated).
 */
export const listPendingForTeacher = async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.role !== "teacher") {
            return res.status(403).json({ message: "Only teachers can list pending requests" });
        }

        const pending = await AccessGrant.find({
            teacherId: user.id,
            status: "pending",
            initiatedBy: "parent",
        })
            .populate("childId", "name leadTeacher")
            .populate("parentId", "name email")
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json({ pending });
    } catch (error) {
        console.error("listPendingForTeacher:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/**
 * Check whether current user can view child / teacher per grants (for UI).
 * GET /api/access/check?childId=&teacherId=
 */
export const checkAccess = async (req, res) => {
    try {
        const { childId, teacherId } = req.query;
        const user = req.user;
        if (!user) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (user.role === "teacher" && childId) {
            const g = await AccessGrant.findOne({
                teacherId: user.id,
                childId,
                status: "active",
            }).lean();
            return res.status(200).json({
                canViewChild: !!g,
                grantStatus: g ? "active" : null,
            });
        }

        if (user.role === "parent" && teacherId) {
            const parent = await Parent.findById(user.id);
            if (!parent) {
                return res.status(404).json({ message: "Parent not found" });
            }
            const childIdStrs = await getResolvedChildIdStringsForParent(parent);
            const filterChildId = childId ? String(childId) : null;
            if (filterChildId && !childIdStrs.includes(filterChildId)) {
                return res.status(403).json({ message: "childId is not one of your linked children" });
            }
            const g = filterChildId
                ? await AccessGrant.findOne({
                      parentId: parent._id,
                      teacherId,
                      childId: filterChildId,
                      status: "active",
                  }).lean()
                : await AccessGrant.findOne({
                      parentId: parent._id,
                      teacherId,
                      childId: { $in: childIdStrs },
                      status: "active",
                  }).lean();
            return res.status(200).json({
                canViewTeacher: !!g,
                grantStatus: g ? "active" : null,
            });
        }

        return res.status(200).json({ message: "No check performed" });
    } catch (error) {
        console.error("checkAccess:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};
