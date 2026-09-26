import mongoose from "mongoose";
import Classroom from "../models/Classroom.js";
import HomeViewGrant from "../models/HomeViewGrant.js";
import CoachClassroomGrant from "../models/CoachClassroomGrant.js";
import ParentClassroomGrant from "../models/ParentClassroomGrant.js";
import { Teacher, Parent, Child, Coach } from "../models/User.js";
import { canManageClassroom } from "../lib/permissions.js";
import { createChartAccessNotification } from "../lib/notificationService.js";
import {
    listEligibleClassroomViewers,
    listEligibleHomeViewers,
} from "../lib/viewerAccessService.js";

function idOf(value) {
    if (value == null) return "";
    return String(value._id ?? value.id ?? value);
}

function isValidId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

async function namesById(Model, ids) {
    if (!ids.length) return {};
    const rows = await Model.find({ _id: { $in: ids } }).select("name email").lean();
    const map = {};
    for (const row of rows) {
        map[String(row._id)] = { id: row._id, name: row.name, email: row.email || "" };
    }
    return map;
}

export const getClassroomViewers = async (req, res) => {
    try {
        const { classroomId } = req.params;
        if (!isValidId(classroomId)) {
            return res.status(400).json({ message: "Invalid classroom id" });
        }
        const classroom = await Classroom.findById(classroomId)
            .select("teacher assistantTeacher parents name")
            .lean();
        if (!classroom) return res.status(404).json({ message: "Classroom not found" });

        const { canViewClassroomAggregates } = await import("../lib/permissions.js");
        if (!(await canViewClassroomAggregates(req.user, classroom))) {
            return res.status(403).json({ message: "You do not have access to this classroom" });
        }

        const eligible = await listEligibleClassroomViewers(classroom);
        const [teacherNames, parentNames, coachNames] = await Promise.all([
            namesById(Teacher, eligible.teacherIds),
            namesById(Parent, eligible.parentIds),
            namesById(Coach, eligible.coachIds),
        ]);
        const parentGrants = await ParentClassroomGrant.find({
            classroomId,
            parentId: { $in: eligible.parentIds },
        }).lean();
        const coachGrants = await CoachClassroomGrant.find({
            classroomId,
            coachId: { $in: eligible.coachIds },
        }).lean();
        const parentStatus = Object.fromEntries(
            parentGrants.map((g) => [String(g.parentId), g.status])
        );
        const coachGrantById = Object.fromEntries(
            coachGrants.map((g) => [String(g.coachId), g])
        );

        const viewers = [
            ...eligible.teacherIds.map((id) => ({
                ...(teacherNames[id] || { id, name: "Teacher" }),
                role: "teacher",
                charts: true,
                transcripts: true,
                switchable: false,
                slot: id === eligible.leadId ? "lead" : id === eligible.assistantId ? "assistant" : "",
            })),
            ...eligible.parentIds.map((id) => ({
                ...(parentNames[id] || { id, name: "Parent" }),
                role: "parent",
                charts: parentStatus[id] !== "revoked",
                transcripts: parentStatus[id] !== "revoked",
                switchable: true,
            })),
            ...eligible.coachIds.map((id) => {
                const grant = coachGrantById[id];
                const revoked = grant?.status === "revoked";
                return {
                    ...(coachNames[id] || { id, name: "Coach" }),
                    role: "coach",
                    charts: !revoked,
                    transcripts: !revoked && !!grant?.transcriptAccess,
                    switchable: true,
                };
            }),
        ];

        const canSwitch =
            req.user?.role === "teacher" &&
            String(classroom.teacher?._id ?? classroom.teacher) === String(req.user.id);

        res.status(200).json({
            place: "classroom",
            classroomId,
            canSwitch,
            adminsAlwaysOn: true,
            viewers,
        });
    } catch (error) {
        console.error("getClassroomViewers:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

export const getHomeViewers = async (req, res) => {
    try {
        const { childId } = req.params;
        if (!isValidId(childId)) {
            return res.status(400).json({ message: "Invalid child id" });
        }
        const child = await Child.findById(childId).select("parents name").lean();
        if (!child) return res.status(404).json({ message: "Child not found" });

        const { canViewerSeeHomeCharts } = await import("../lib/viewerAccessService.js");
        if (!(await canViewerSeeHomeCharts(req.user, childId))) {
            return res.status(403).json({ message: "You do not have access to this child's home data" });
        }

        const eligible = await listEligibleHomeViewers(childId);
        const teacherRows = (eligible.teachers || []).map((teacher) =>
            typeof teacher === "string" ? { id: teacher, slot: "" } : teacher
        );
        const teacherIds = teacherRows.map((teacher) => teacher.id);
        const [teacherNames, coachNames, parentNames] = await Promise.all([
            namesById(Teacher, teacherIds),
            namesById(Coach, eligible.coaches),
            namesById(Parent, eligible.parentIds),
        ]);
        const grants = await HomeViewGrant.find({
            childId,
            scope: "user",
            granteeId: { $in: [...teacherIds, ...eligible.coaches] },
        }).lean();
        const grantById = Object.fromEntries(grants.map((g) => [String(g.granteeId), g]));

        const viewers = [
            ...eligible.parentIds.map((id) => ({
                ...(parentNames[id] || { id, name: "Parent" }),
                role: "parent",
                charts: true,
                transcripts: true,
                switchable: false,
            })),
            ...teacherRows.map((teacher) => {
                const id = teacher.id;
                const grant = grantById[id];
                const revoked = grant?.status === "revoked";
                return {
                    ...(teacherNames[id] || { id, name: "Teacher" }),
                    role: "teacher",
                    slot: teacher.slot || "",
                    charts: !revoked,
                    transcripts: !revoked && !!grant?.transcriptAccess,
                    switchable: true,
                };
            }),
            ...eligible.coaches.map((id) => {
                const grant = grantById[id];
                const revoked = grant?.status === "revoked";
                return {
                    ...(coachNames[id] || { id, name: "Coach" }),
                    role: "coach",
                    charts: !revoked,
                    transcripts: !revoked && !!grant?.transcriptAccess,
                    switchable: true,
                };
            }),
        ];

        const canSwitch =
            req.user?.role === "parent" &&
            (child.parents || []).some((p) => String(p) === String(req.user.id));

        res.status(200).json({
            place: "home",
            childId,
            canSwitch,
            adminsAlwaysOn: true,
            viewers,
        });
    } catch (error) {
        console.error("getHomeViewers:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

export const setClassroomChartStatus = async (req, res) => {
    try {
        const { classroomId } = req.params;
        const { viewerId, viewerRole, charts } = req.body || {};
        if (!isValidId(classroomId) || !isValidId(viewerId)) {
            return res.status(400).json({ message: "Invalid id" });
        }
        if (!["parent", "coach"].includes(viewerRole)) {
            return res.status(400).json({ message: "Only parent and coach classroom charts can be switched" });
        }
        const classroom = await Classroom.findById(classroomId);
        if (!classroom) return res.status(404).json({ message: "Classroom not found" });
        if (req.user?.role !== "teacher" || !canManageClassroom(req.user, classroom)) {
            return res.status(403).json({ message: "Only the classroom lead or assistant can change chart access" });
        }
        if (idOf(classroom.teacher) !== String(req.user.id)) {
            return res.status(403).json({ message: "Only the lead teacher can change chart access" });
        }

        const nextStatus = charts ? "active" : "revoked";
        if (viewerRole === "parent") {
            await ParentClassroomGrant.findOneAndUpdate(
                { parentId: viewerId, classroomId },
                { $set: { status: nextStatus } },
                { upsert: true, new: true }
            );
        } else {
            const grant = await CoachClassroomGrant.findOneAndUpdate(
                { coachId: viewerId, classroomId },
                {
                    $set: {
                        status: nextStatus,
                        ...(charts ? {} : { transcriptAccess: false }),
                    },
                    ...(charts ? { $setOnInsert: { transcriptAccess: false } } : {}),
                },
                { upsert: true, new: true }
            );
            if (charts && grant) {
                grant.transcriptAccess = false;
                await grant.save();
            }
        }

        await createChartAccessNotification({
            recipientId: viewerId,
            recipientRole: viewerRole,
            place: "classroom",
            classroom,
            chartsOn: Boolean(charts),
        });

        res.status(200).json({ ok: true, charts: Boolean(charts) });
    } catch (error) {
        console.error("setClassroomChartStatus:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

export const setHomeChartStatus = async (req, res) => {
    try {
        const { childId } = req.params;
        const { viewerId, viewerRole, charts } = req.body || {};
        if (!isValidId(childId) || !isValidId(viewerId)) {
            return res.status(400).json({ message: "Invalid id" });
        }
        if (!["teacher", "coach"].includes(viewerRole)) {
            return res.status(400).json({ message: "Only teacher and coach home charts can be switched" });
        }
        const child = await Child.findById(childId).select("parents name");
        if (!child) return res.status(404).json({ message: "Child not found" });
        const isParent =
            req.user?.role === "parent" &&
            (child.parents || []).some((p) => String(p) === String(req.user.id));
        if (!isParent) {
            return res.status(403).json({ message: "Only a linked parent can change home chart access" });
        }

        const nextStatus = charts ? "active" : "revoked";
        const grant = await HomeViewGrant.findOneAndUpdate(
            { childId, scope: "user", granteeId: viewerId },
            {
                $set: {
                    status: nextStatus,
                    granteeRole: viewerRole,
                    initiatedBy: "parent",
                    ...(charts ? { transcriptAccess: false } : { transcriptAccess: false }),
                },
            },
            { upsert: true, new: true }
        );
        if (charts && grant) {
            grant.transcriptAccess = false;
            await grant.save();
        }

        await createChartAccessNotification({
            recipientId: viewerId,
            recipientRole: viewerRole,
            place: "home",
            child,
            chartsOn: Boolean(charts),
        });

        res.status(200).json({ ok: true, charts: Boolean(charts) });
    } catch (error) {
        console.error("setHomeChartStatus:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

export const goneRequestFlow = (_req, res) => {
    return res.status(410).json({
        message: "Access requests are no longer used. Charts open automatically; use Currently accessing to revoke.",
    });
};
