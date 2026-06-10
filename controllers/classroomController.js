import mongoose from "mongoose";
import Classroom from "../models/Classroom.js";
import Assessment from "../models/Assessment.js";
import { Teacher, Parent, Child } from "../models/User.js";
import { isSameCenter } from "../lib/centerNames.js";
import {
    canManageClassroom,
    classroomRoleForUser,
    validateAssistant,
    resolveChildCenter,
    parseInvitePayload,
} from "../lib/classroomHelpers.js";
import { computeCohortStatsFromAssessments } from "../lib/cohortStatsService.js";

function toClassroomSummary(classroom, user) {
    return {
        id: classroom._id,
        name: classroom.name,
        center: classroom.center,
        teacher: classroom.teacher
            ? { id: classroom.teacher._id ?? classroom.teacher, name: classroom.teacher.name ?? null }
            : null,
        assistantTeacher: classroom.assistantTeacher
            ? { id: classroom.assistantTeacher._id ?? classroom.assistantTeacher, name: classroom.assistantTeacher.name ?? null }
            : null,
        childCount: Array.isArray(classroom.children) ? classroom.children.length : 0,
        role: classroomRoleForUser(user, classroom),
    };
}

export const createClassroom = async (req, res) => {
    try {
        const user = req.user;
        if (user.role !== "admin" && user.role !== "teacher") {
            return res.status(403).json({ message: "Only admins and teachers can create classrooms" });
        }

        const { name, center: bodyCenter, teacherId: bodyTeacherId, assistantTeacherId } = req.body;
        const trimmedName = typeof name === "string" ? name.trim() : "";
        if (!trimmedName) {
            return res.status(400).json({ message: "Classroom name is required" });
        }

        // Resolve the lead teacher and center per role. Teachers can never
        // override their own identity/center; admins must pick both.
        let leadTeacher;
        let center;
        if (user.role === "teacher") {
            leadTeacher = await Teacher.findById(user.id);
            if (!leadTeacher) {
                return res.status(404).json({ message: "Your teacher account was not found" });
            }
            center = leadTeacher.center;
        } else {
            if (!bodyTeacherId) {
                return res.status(400).json({ message: "Lead teacher is required" });
            }
            if (!bodyCenter || !String(bodyCenter).trim()) {
                return res.status(400).json({ message: "Center is required" });
            }
            if (!mongoose.Types.ObjectId.isValid(bodyTeacherId)) {
                return res.status(400).json({ message: "Invalid lead teacher id" });
            }
            leadTeacher = await Teacher.findById(bodyTeacherId);
            if (!leadTeacher) {
                return res.status(404).json({ message: "Lead teacher not found" });
            }
            if (!isSameCenter(leadTeacher.center, bodyCenter)) {
                return res.status(400).json({ message: "Selected teacher does not belong to the chosen center" });
            }
            center = String(bodyCenter).trim();
        }

        let assistantDoc = null;
        if (assistantTeacherId) {
            if (!mongoose.Types.ObjectId.isValid(assistantTeacherId)) {
                return res.status(400).json({ message: "Invalid assistant teacher id" });
            }
            assistantDoc = await Teacher.findById(assistantTeacherId);
            const check = validateAssistant({
                leadId: leadTeacher._id,
                assistantDoc,
                classroomCenter: center,
            });
            if (!check.ok) {
                return res.status(400).json({ message: check.message });
            }
        }

        const classroom = new Classroom({
            name: trimmedName,
            teacher: leadTeacher._id,
            assistantTeacher: assistantDoc ? assistantDoc._id : null,
            center,
            children: [],
            parents: [],
        });
        await classroom.save();

        res.status(201).json({
            message: "Classroom created successfully",
            classroom: {
                id: classroom._id,
                name: classroom.name,
                center: classroom.center,
                teacher: { id: leadTeacher._id, name: leadTeacher.name },
                assistantTeacher: assistantDoc ? { id: assistantDoc._id, name: assistantDoc.name } : null,
            },
        });
    } catch (error) {
        console.error("Error creating classroom:", error);
        res.status(500).json({ message: error.message });
    }
};

export const listClassrooms = async (req, res) => {
    try {
        const user = req.user;

        // Parents get a read-only scoped list: classrooms where they are a
        // member, with each row flagged with THEIR enrolled children. All
        // classroom administration endpoints remain parent-denied.
        if (user.role === "parent") {
            const parent = await Parent.findById(user.id).select("childIds");
            if (!parent) {
                return res.status(404).json({ message: "Parent not found" });
            }
            const myChildIds = new Set((parent.childIds || []).map((id) => String(id)));
            const classrooms = await Classroom.find({ parents: user.id })
                .populate("teacher", "name")
                .populate("assistantTeacher", "name")
                .populate("children", "name")
                .sort({ name: 1 });

            return res.status(200).json({
                classrooms: classrooms.map((c) => ({
                    ...toClassroomSummary(c, user),
                    enrolledChildren: (c.children || [])
                        .filter((child) => myChildIds.has(String(child._id)))
                        .map((child) => ({ id: child._id, name: child.name })),
                })),
            });
        }

        if (user.role !== "admin" && user.role !== "teacher") {
            return res.status(403).json({ message: "Access denied" });
        }

        const filter = user.role === "admin"
            ? {}
            : { $or: [{ teacher: user.id }, { assistantTeacher: user.id }] };

        const classrooms = await Classroom.find(filter)
            .populate("teacher", "name")
            .populate("assistantTeacher", "name")
            .sort({ name: 1 });

        res.status(200).json({
            classrooms: classrooms.map((c) => toClassroomSummary(c, user)),
        });
    } catch (error) {
        console.error("Error listing classrooms:", error);
        res.status(500).json({ message: error.message });
    }
};

async function findAuthorizedClassroom(req, res) {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ message: "Invalid classroom id" });
        return null;
    }
    const classroom = await Classroom.findById(id)
        .populate("teacher", "name center")
        .populate("assistantTeacher", "name center")
        .populate("children", "name leadTeacher")
        .populate("parents", "name email childIds");
    if (!classroom) {
        res.status(404).json({ message: "Classroom not found" });
        return null;
    }
    if (!canManageClassroom(req.user, classroom)) {
        res.status(403).json({ message: "You do not have access to this classroom" });
        return null;
    }
    return classroom;
}

export const getClassroom = async (req, res) => {
    try {
        const classroom = await findAuthorizedClassroom(req, res);
        if (!classroom) return;

        res.status(200).json({
            classroom: {
                ...toClassroomSummary(classroom, req.user),
                children: (classroom.children || []).map((c) => ({ id: c._id, name: c.name })),
                // childIds lets the client map each child to their classroom
                // parent(s) without an extra request.
                parents: (classroom.parents || []).map((p) => ({
                    id: p._id,
                    name: p.name,
                    email: p.email,
                    childIds: (p.childIds || []).map((cid) => String(cid)),
                })),
            },
        });
    } catch (error) {
        console.error("Error fetching classroom:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getEligibleParents = async (req, res) => {
    try {
        const classroom = await findAuthorizedClassroom(req, res);
        if (!classroom) return;

        const memberParentIds = (classroom.parents || []).map((p) => String(p._id ?? p));
        const parents = await Parent.find({ invitationAccepted: true })
            .select("name email childIds childId")
            .populate("childIds", "name")
            .sort({ name: 1 });

        const eligible = parents
            .filter((p) => !memberParentIds.includes(String(p._id)))
            .map((p) => ({
                id: p._id,
                name: p.name,
                email: p.email,
                children: (p.childIds || []).map((c) => ({ id: c._id, name: c.name })),
            }));

        res.status(200).json({ parents: eligible });
    } catch (error) {
        console.error("Error fetching eligible parents:", error);
        res.status(500).json({ message: error.message });
    }
};

export const inviteParents = async (req, res) => {
    try {
        const classroom = await findAuthorizedClassroom(req, res);
        if (!classroom) return;

        // New shape: invites: [{ parentId, childIds?: [] }] — per-child enrollment.
        // Legacy shape: parentIds: [] — enroll all eligible children.
        const parsed = parseInvitePayload(req.body);
        if (!parsed.ok) {
            return res.status(400).json({ message: parsed.message });
        }

        const addedParents = [];
        const skippedChildren = [];
        const childIdsToAdd = new Set();

        for (const { parentId, childIds } of parsed.entries) {
            if (!mongoose.Types.ObjectId.isValid(parentId)) {
                return res.status(400).json({ message: `Invalid parent id: ${parentId}` });
            }
            const parent = await Parent.findById(parentId).populate("childIds", "name leadTeacher");
            if (!parent) {
                return res.status(404).json({ message: "Parent not found" });
            }
            if (!parent.invitationAccepted) {
                return res.status(400).json({
                    message: `${parent.name} has not accepted their primary invitation yet`,
                });
            }

            // Resolve which of this parent's children to enroll. An explicit
            // selection must only reference the parent's own children.
            const ownChildren = parent.childIds || [];
            let selectedChildren;
            if (childIds === null) {
                selectedChildren = ownChildren;
            } else {
                const ownIdSet = new Set(ownChildren.map((c) => String(c._id)));
                for (const cid of childIds) {
                    if (!ownIdSet.has(cid)) {
                        return res.status(400).json({
                            message: `Selected child does not belong to ${parent.name}`,
                        });
                    }
                }
                const wanted = new Set(childIds);
                selectedChildren = ownChildren.filter((c) => wanted.has(String(c._id)));
            }

            addedParents.push(parent._id);

            // Enroll only the selected children whose center (derived via their
            // lead teacher) matches the classroom's center.
            for (const child of selectedChildren) {
                const childCenter = await resolveChildCenter(child);
                if (childCenter != null && isSameCenter(childCenter, classroom.center)) {
                    childIdsToAdd.add(String(child._id));
                } else {
                    skippedChildren.push({ id: child._id, name: child.name, reason: "different-center" });
                }
            }
        }

        await Classroom.updateOne(
            { _id: classroom._id },
            {
                $addToSet: {
                    parents: { $each: addedParents },
                    children: { $each: [...childIdsToAdd].map((id) => new mongoose.Types.ObjectId(id)) },
                },
            }
        );

        res.status(200).json({
            message: `Added ${addedParents.length} parent${addedParents.length === 1 ? "" : "s"} to the classroom`,
            addedParents: addedParents.length,
            addedChildren: childIdsToAdd.size,
            skippedChildren,
        });
    } catch (error) {
        console.error("Error inviting parents to classroom:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getClassroomAssessments = async (req, res) => {
    try {
        const classroom = await findAuthorizedClassroom(req, res);
        if (!classroom) return;

        const childIds = (classroom.children || []).map((c) => c._id ?? c);
        const assessments = childIds.length === 0
            ? []
            : await Assessment.find({ childId: { $in: childIds } })
                .select("childId date categoryWPM wordsPerMinute classroomId")
                .sort({ date: 1 })
                .lean();

        // Classroom-scoped thresholds: same "average of per-child min/max"
        // semantics as the global children cohort, restricted to members.
        const cohortStats = computeCohortStatsFromAssessments(assessments, "childId");

        res.status(200).json({
            assessments,
            cohortStats,
            childCount: childIds.length,
        });
    } catch (error) {
        console.error("Error fetching classroom assessments:", error);
        res.status(500).json({ message: error.message });
    }
};
