import mongoose from "mongoose";
import HomeViewGrant from "../models/HomeViewGrant.js";
import Classroom from "../models/Classroom.js";
import { Parent, Teacher, Admin, Child } from "../models/User.js";
import { parentMayAccessChild } from "../lib/parentChildHelpers.js";
import {
    teacherMayAccessChild,
    findParentsLinkedToChild,
} from "../lib/noteAccessHelpers.js";
import { fanOutHomeAccessRequestedNotifications } from "../lib/notificationService.js";

function isValidId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

async function loadVerifiedParent(user, childId) {
    if (user?.role !== "parent") return null;
    const parent = await Parent.findById(user.id);
    if (!parent || !(await parentMayAccessChild(parent, childId))) return null;
    return parent;
}

async function granteeNameOf(granteeId, granteeRole) {
    const Model = granteeRole === "admin" ? Admin : Teacher;
    const doc = await Model.findById(granteeId).select("name").lean();
    return doc?.name || (granteeRole === "admin" ? "An admin" : "A teacher");
}

/**
 * GET /api/home-access/child/:childId
 * Parent: full sharing state (all-staff status, per-classroom lead rows,
 * pending staff requests). Staff: their own effective status only.
 */
export const getHomeAccessState = async (req, res) => {
    try {
        const { childId } = req.params;
        const user = req.user;
        if (!isValidId(childId)) {
            return res.status(400).json({ message: "Invalid child id" });
        }

        if (user.role === "teacher" || user.role === "admin") {
            const grants = await HomeViewGrant.find({
                childId,
                $or: [{ scope: "all-staff" }, { scope: "user", granteeId: user.id }],
            }).lean();
            const allStaffActive = grants.some(
                (g) => g.scope === "all-staff" && g.status === "active"
            );
            const own = grants.find((g) => g.scope === "user");
            let status = "none";
            if (allStaffActive || own?.status === "active") status = "granted";
            else if (own?.status === "pending") status = "pending";
            return res.status(200).json({ status });
        }

        const parent = await loadVerifiedParent(user, childId);
        if (!parent) {
            return res.status(403).json({ message: "You do not have access to this child" });
        }

        const child = await Child.findById(childId).select("classrooms").lean();
        if (!child) {
            return res.status(404).json({ message: "Child not found" });
        }

        const [grants, rooms] = await Promise.all([
            HomeViewGrant.find({ childId }).lean(),
            Classroom.find({ _id: { $in: child.classrooms || [] } })
                .select("name teacher")
                .populate("teacher", "name")
                .lean(),
        ]);

        const allStaffGrant = grants.find((g) => g.scope === "all-staff");
        const userGrants = grants.filter((g) => g.scope === "user");
        const grantByGrantee = new Map(
            userGrants.map((g) => [String(g.granteeId), g])
        );

        const classrooms = rooms.map((room) => {
            const leadId = room.teacher?._id ? String(room.teacher._id) : null;
            const grant = leadId ? grantByGrantee.get(leadId) : null;
            return {
                classroomId: String(room._id),
                classroomName: room.name || "",
                leadTeacherId: leadId,
                leadTeacherName: room.teacher?.name || null,
                status: grant?.status === "active" ? "active" : grant?.status === "pending" ? "pending" : "none",
                grantId: grant ? String(grant._id) : null,
            };
        });

        const pendingGrants = userGrants.filter((g) => g.status === "pending");
        const pendingRequests = await Promise.all(
            pendingGrants.map(async (g) => ({
                grantId: String(g._id),
                granteeId: String(g.granteeId),
                granteeRole: g.granteeRole,
                granteeName: await granteeNameOf(g.granteeId, g.granteeRole),
                createdAt: g.createdAt,
            }))
        );

        return res.status(200).json({
            allStaff: {
                status: allStaffGrant?.status === "active" ? "active" : "none",
            },
            classrooms,
            pendingRequests,
        });
    } catch (error) {
        console.error("getHomeAccessState:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/**
 * POST /api/home-access/child/:childId/grant
 * Parent only. Body: { scope: "all-staff" } | { classroomId } | { grantId }.
 * - all-staff: upsert the child's all-staff grant to active.
 * - classroomId: resolve the classroom's CURRENT lead teacher and upsert
 *   their user-scoped grant to active (also activates a matching pending
 *   staff request — same unique document).
 * - grantId: approve a specific pending staff request (e.g. from an admin).
 */
export const grantHomeAccess = async (req, res) => {
    try {
        const { childId } = req.params;
        const { scope, classroomId, grantId } = req.body || {};
        const user = req.user;
        if (!isValidId(childId)) {
            return res.status(400).json({ message: "Invalid child id" });
        }
        const parent = await loadVerifiedParent(user, childId);
        if (!parent) {
            return res.status(403).json({ message: "Only the child's parent can grant home view access" });
        }

        if (scope === "all-staff") {
            const grant = await HomeViewGrant.findOneAndUpdate(
                { childId, scope: "all-staff", granteeId: null },
                { $set: { status: "active", initiatedBy: "parent" } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            return res.status(200).json({ message: "Home view access granted to all teachers and admins", grant });
        }

        if (grantId) {
            if (!isValidId(grantId)) {
                return res.status(400).json({ message: "Invalid grant id" });
            }
            const grant = await HomeViewGrant.findOne({ _id: grantId, childId });
            if (!grant) {
                return res.status(404).json({ message: "Request not found" });
            }
            grant.status = "active";
            await grant.save();
            return res.status(200).json({ message: "Home view access granted", grant });
        }

        if (classroomId) {
            if (!isValidId(classroomId)) {
                return res.status(400).json({ message: "Invalid classroom id" });
            }
            const child = await Child.findById(childId).select("classrooms").lean();
            const enrolled = (child?.classrooms || []).some(
                (id) => String(id) === String(classroomId)
            );
            if (!enrolled) {
                return res.status(400).json({ message: "This classroom is not one of the child's classrooms" });
            }
            const classroom = await Classroom.findById(classroomId).select("teacher").lean();
            if (!classroom?.teacher) {
                return res.status(400).json({ message: "This classroom has no lead teacher to grant" });
            }
            // Grant binds to the lead teacher AT GRANT TIME — a later lead
            // reassignment must not silently transfer home data access.
            const grant = await HomeViewGrant.findOneAndUpdate(
                { childId, scope: "user", granteeId: classroom.teacher },
                {
                    $set: {
                        status: "active",
                        granteeRole: "teacher",
                        classroomId: classroom._id,
                        initiatedBy: "parent",
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            return res.status(200).json({ message: "Home view access granted to the classroom's lead teacher", grant });
        }

        return res.status(400).json({ message: "Provide scope 'all-staff', a classroomId, or a grantId" });
    } catch (error) {
        console.error("grantHomeAccess:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/**
 * POST /api/home-access/child/:childId/revoke
 * Parent only. Body: { scope: "all-staff" } | { grantId }.
 */
export const revokeHomeAccess = async (req, res) => {
    try {
        const { childId } = req.params;
        const { scope, grantId } = req.body || {};
        const user = req.user;
        if (!isValidId(childId)) {
            return res.status(400).json({ message: "Invalid child id" });
        }
        const parent = await loadVerifiedParent(user, childId);
        if (!parent) {
            return res.status(403).json({ message: "Only the child's parent can revoke home view access" });
        }

        let grant = null;
        if (scope === "all-staff") {
            grant = await HomeViewGrant.findOne({ childId, scope: "all-staff" });
        } else if (grantId && isValidId(grantId)) {
            grant = await HomeViewGrant.findOne({ _id: grantId, childId });
        } else {
            return res.status(400).json({ message: "Provide scope 'all-staff' or a grantId" });
        }

        if (!grant) {
            return res.status(404).json({ message: "Grant not found" });
        }
        grant.status = "revoked";
        await grant.save();
        return res.status(200).json({ message: "Home view access revoked", grant });
    } catch (error) {
        console.error("revokeHomeAccess:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/**
 * POST /api/home-access/child/:childId/request
 * Teacher (must already have child access) or admin. Idempotent: an
 * existing pending/active grant (or an active all-staff grant) means no
 * new document and no new notification. On a NEW pending request the
 * child's parents each get a `home-access-requested` notification;
 * notification failures never roll back the grant write.
 */
export const requestHomeAccess = async (req, res) => {
    try {
        const { childId } = req.params;
        const user = req.user;
        if (!isValidId(childId)) {
            return res.status(400).json({ message: "Invalid child id" });
        }

        if (user.role === "teacher") {
            const ok = await teacherMayAccessChild(user.id, childId);
            if (!ok) {
                return res.status(403).json({ message: "You do not have access to this child" });
            }
        } else if (user.role !== "admin") {
            return res.status(403).json({ message: "Only teachers and admins can request home view access" });
        }

        const existing = await HomeViewGrant.findOne({
            childId,
            $or: [{ scope: "all-staff" }, { scope: "user", granteeId: user.id }],
            status: { $in: ["pending", "active"] },
        }).lean();
        if (existing) {
            const granted =
                existing.status === "active";
            return res.status(200).json({
                message: granted
                    ? "You already have home view access for this child"
                    : "Your request is already pending",
                status: granted ? "granted" : "pending",
            });
        }

        const grant = await HomeViewGrant.findOneAndUpdate(
            { childId, scope: "user", granteeId: user.id },
            {
                $set: {
                    status: "pending",
                    granteeRole: user.role,
                    initiatedBy: "staff",
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        try {
            const { child, parents } = await findParentsLinkedToChild(childId);
            if (child && parents.length > 0) {
                await fanOutHomeAccessRequestedNotifications({
                    child,
                    parentIds: parents.map((p) => p._id),
                    requesterName: user.name || "A staff member",
                    requesterRole: user.role,
                });
            }
        } catch (notifyErr) {
            console.error(
                "[homeAccessController] home access request notification failed:",
                notifyErr.message
            );
        }

        return res.status(201).json({
            message: "Request sent. The child's parent will be notified.",
            status: "pending",
            grant,
        });
    } catch (error) {
        console.error("requestHomeAccess:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};
