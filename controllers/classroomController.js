import mongoose from "mongoose";
import Classroom from "../models/Classroom.js";
import Assessment from "../models/Assessment.js";
import TeacherAssessment from "../models/TeacherAssessment.js";
import Invitation from "../models/Invitation.js";
import { Teacher, Parent, Child } from "../models/User.js";
import { syncAccessGrantsForParentTeacherPair } from "../lib/parentChildHelpers.js";
import { isSameCenter } from "../lib/centerNames.js";
import {
    canManageClassroom,
    classroomRoleForUser,
    validateAssistant,
    resolveChildCenter,
    parseInvitePayload,
} from "../lib/classroomHelpers.js";
import { computeCohortStatsFromAssessments } from "../lib/cohortStatsService.js";
import {
    fanOutClassroomAddedNotifications,
    fanOutClassroomRemovedNotification,
} from "../lib/notificationService.js";
import { readSchoolFromBody, withSchoolField } from "../lib/schoolFieldAlias.js";
import { materializeAndSyncClassroomChildren } from "../lib/classroomMembershipSync.js";

/**
 * Build the summary projection used by every classroom response. The
 * `roleOverride` argument is what lets parent-read mode bypass the
 * default teacher-centric `classroomRoleForUser` (which returns null for
 * parents) and emit `role: "parent"` on the wire. Admins continue to
 * receive `role: "admin"`.
 */
function toClassroomSummary(classroom, user, roleOverride = null) {
    let role = roleOverride;
    if (role == null) {
        if (user?.role === "admin") role = "admin";
        else role = classroomRoleForUser(user, classroom);
    }
    return {
        id: classroom._id,
        name: classroom.name,
        center: classroom.center,
        school: classroom.center,
        teacher: classroom.teacher
            ? { id: classroom.teacher._id ?? classroom.teacher, name: classroom.teacher.name ?? null }
            : null,
        assistantTeacher: classroom.assistantTeacher
            ? { id: classroom.assistantTeacher._id ?? classroom.assistantTeacher, name: classroom.assistantTeacher.name ?? null }
            : null,
        childCount: Array.isArray(classroom.children) ? classroom.children.length : 0,
        role,
    };
}

export const createClassroom = async (req, res) => {
    try {
        const user = req.user;
        if (user.role !== "admin" && user.role !== "teacher") {
            return res.status(403).json({ message: "Only admins and teachers can create classrooms" });
        }

        const { name, teacherId: bodyTeacherId, assistantTeacherId } = req.body;
        const bodyCenter = readSchoolFromBody(req.body);
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
            if (!bodyCenter) {
                return res.status(400).json({ message: "School is required" });
            }
            if (!mongoose.Types.ObjectId.isValid(bodyTeacherId)) {
                return res.status(400).json({ message: "Invalid lead teacher id" });
            }
            leadTeacher = await Teacher.findById(bodyTeacherId);
            if (!leadTeacher) {
                return res.status(404).json({ message: "Lead teacher not found" });
            }
            if (!isSameCenter(leadTeacher.center, bodyCenter)) {
                return res.status(400).json({ message: "Selected teacher does not belong to the chosen school" });
            }
            center = bodyCenter;
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

        // Notify the lead and (optional) assistant teacher that they
        // have been assigned to this new classroom. Same fan-out helper
        // as `inviteParents` so the dedupe logic stays in one place.
        const teacherRecipients = [
            { id: leadTeacher._id, role: "teacher" },
        ];
        if (assistantDoc) {
            teacherRecipients.push({ id: assistantDoc._id, role: "teacher" });
        }
        await fanOutClassroomAddedNotifications({
            classroom,
            recipients: teacherRecipients,
        });

        res.status(201).json({
            message: "Classroom created successfully",
            classroom: withSchoolField({
                id: classroom._id,
                name: classroom.name,
                center: classroom.center,
                teacher: { id: leadTeacher._id, name: leadTeacher.name },
                assistantTeacher: assistantDoc ? { id: assistantDoc._id, name: assistantDoc.name } : null,
            }),
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

/**
 * Returns `{ classroom, mode }` where mode is:
 *   - "manage": admins and lead/assistant teachers (full payload + writes)
 *   - "read":   parents who appear in the classroom's `parents` array
 *               (read-only payloads, scoped to their own children)
 *
 * On any auth/lookup failure this writes the appropriate response body
 * and returns null — callers should `if (!auth) return;`.
 */
async function findAuthorizedClassroom(req, res) {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ message: "Invalid classroom id" });
        return null;
    }
    const classroom = await Classroom.findById(id)
        .populate("teacher", "name center")
        .populate("assistantTeacher", "name center")
        .populate("children", "name center classrooms")
        .populate("parents", "name email childIds");
    if (!classroom) {
        res.status(404).json({ message: "Classroom not found" });
        return null;
    }
    if (canManageClassroom(req.user, classroom)) {
        return { classroom, mode: "manage" };
    }
    // Parent read-only: must be a parent role AND a member of the classroom.
    if (req.user?.role === "parent") {
        const uid = String(req.user.id ?? "");
        const isMember = (classroom.parents || []).some(
            (p) => String(p._id ?? p) === uid
        );
        if (isMember) return { classroom, mode: "read" };
    }
    res.status(403).json({ message: "You do not have access to this classroom" });
    return null;
}

export const getClassroom = async (req, res) => {
    try {
        const auth = await findAuthorizedClassroom(req, res);
        if (!auth) return;
        const { classroom, mode } = auth;

        const { summaries: rosterChildren } =
            await materializeAndSyncClassroomChildren(classroom);

        // Parent read-only payload: hide the full roster, surface only
        // the parent's own children. Counts come from the unfiltered
        // arrays so the parent still sees the classroom's true size.
        if (mode === "read") {
            const uid = String(req.user.id);
            const myChildIdSet = new Set();
            for (const p of classroom.parents || []) {
                if (String(p._id ?? p) === uid) {
                    for (const cid of p.childIds || []) {
                        myChildIdSet.add(String(cid));
                    }
                }
            }
            const myChildren = rosterChildren.filter((c) =>
                myChildIdSet.has(String(c.id))
            );

            return res.status(200).json({
                classroom: {
                    ...toClassroomSummary(classroom, req.user, "parent"),
                    childCount: rosterChildren.length,
                    children: myChildren,
                    parents: [],
                },
            });
        }

        res.status(200).json({
            classroom: {
                ...toClassroomSummary(classroom, req.user),
                childCount: rosterChildren.length,
                children: rosterChildren,
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
        const auth = await findAuthorizedClassroom(req, res);
        if (!auth) return;
        const { classroom, mode } = auth;
        // Parents can't enumerate other parents.
        if (mode !== "manage") {
            return res
                .status(403)
                .json({ message: "Only admins and classroom teachers can list parents" });
        }

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
        const auth = await findAuthorizedClassroom(req, res);
        if (!auth) return;
        const { classroom, mode } = auth;
        if (mode !== "manage") {
            return res
                .status(403)
                .json({ message: "Only admins and classroom teachers can add parents" });
        }

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
            const parent = await Parent.findById(parentId).populate("childIds", "name center classrooms");
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

        const childOidsToAdd = [...childIdsToAdd].map(
            (id) => new mongoose.Types.ObjectId(id)
        );

        await Classroom.updateOne(
            { _id: classroom._id },
            {
                $addToSet: {
                    parents: { $each: addedParents },
                    children: { $each: childOidsToAdd },
                },
            }
        );

        // Mirror the classroom-side membership onto each enrolled child so
        // teacher-side fan-out (getSupervisedChildrenForTeacher) and the
        // classroom-membership-driven access grant logic stay in sync.
        if (childOidsToAdd.length > 0) {
            await Child.updateMany(
                { _id: { $in: childOidsToAdd } },
                { $addToSet: { classrooms: classroom._id } }
            );
        }

        // Re-sync AccessGrants for every (parent, teacher) pair that now
        // shares this classroom — gives the lead + assistant teacher
        // immediate visibility on the newly enrolled children without
        // forcing a separate access-request round trip.
        const teacherIds = [classroom.teacher].filter(Boolean);
        if (classroom.assistantTeacher) teacherIds.push(classroom.assistantTeacher);
        for (const parentId of addedParents) {
            for (const tid of teacherIds) {
                try {
                    await syncAccessGrantsForParentTeacherPair(parentId, tid);
                } catch (grantErr) {
                    console.error(
                        "[classroom invite] syncAccessGrants failed:",
                        grantErr.message
                    );
                }
            }
        }

        // Fan out classroom-added notifications. Parents that were just
        // added always get one. The lead/assistant teacher are notified
        // the FIRST time they become responsible for this classroom; the
        // helper's idempotency check (no unexpired `classroom-added`
        // row for this recipient+classroom) prevents repeats on every
        // subsequent invite. Failures are swallowed by the service —
        // they must never block the membership write.
        const teacherRecipients = teacherIds.map((id) => ({
            id,
            role: "teacher",
        }));
        const parentRecipients = addedParents.map((id) => ({
            id,
            role: "parent",
        }));
        await fanOutClassroomAddedNotifications({
            classroom,
            recipients: [...parentRecipients, ...teacherRecipients],
        });

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

/**
 * DELETE /api/classrooms/:id
 *
 * Authorization: admin OR the classroom's lead teacher. Assistant
 * teachers are intentionally excluded — they can record but not retire
 * the classroom (D2 in the design).
 *
 * Cascade (single sequenced operation; see design D1):
 *  - Pull this classroom's id from every member child's `classrooms[]`.
 *  - Null out `classroomId` on historical Assessment / TeacherAssessment
 *    rows (per-child progress history is preserved; the row is no
 *    longer mis-attributed).
 *  - Hard-delete any pending `Invitation` rows targeting this classroom
 *    (no audit trail kept; accepted invitations are left untouched).
 *  - Delete the Classroom document itself.
 *  - Teacher / Parent / Child documents are otherwise untouched.
 *
 * NOTE: This codebase's `Invitation` model has no `classroomId` field
 * (classroom enrollment is performed against already-registered parents
 * via `inviteParents`; the email-token flow is parent-link-only). The
 * pending-invitation cascade therefore matches zero rows in current
 * shape; the deleteMany is in place so the cascade stays correct once a
 * future change starts stamping `classroomId` on emailed invitations.
 */
export const deleteClassroom = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid classroom id" });
        }
        const classroom = await Classroom.findById(id);
        if (!classroom) {
            return res.status(404).json({ message: "Classroom not found" });
        }

        const user = req.user;
        if (!user) {
            return res.status(401).json({ message: "Authentication required" });
        }
        const isAdmin = user.role === "admin";
        const isLead =
            user.role === "teacher" &&
            String(classroom.teacher) === String(user.id);
        if (!isAdmin && !isLead) {
            return res.status(403).json({
                message: "Only an admin or the classroom's lead teacher can delete it",
            });
        }

        const memberChildIds = Array.isArray(classroom.children)
            ? classroom.children
            : [];
        const memberParentIds = Array.isArray(classroom.parents)
            ? classroom.parents
            : [];

        const childPull =
            memberChildIds.length > 0
                ? await Child.updateMany(
                      { _id: { $in: memberChildIds } },
                      { $pull: { classrooms: classroom._id } }
                  )
                : { modifiedCount: 0 };

        const assessmentNull = await Assessment.updateMany(
            { classroomId: classroom._id },
            { $set: { classroomId: null } }
        );
        const teacherAssessmentNull = await TeacherAssessment.updateMany(
            { classroomId: classroom._id },
            { $set: { classroomId: null } }
        );

        // Hard-delete pending invitations targeting this classroom. The
        // schema accepts the query even when classroomId isn't a defined
        // path (mongoose just returns zero matches), so we stay forward
        // compatible.
        const invitationsDelete = await Invitation.deleteMany({
            classroomId: classroom._id,
            status: "pending",
        });

        await Classroom.deleteOne({ _id: classroom._id });

        return res.status(200).json({
            ok: true,
            summary: {
                childrenUnlinked: childPull.modifiedCount ?? 0,
                parentsUnlinked: memberParentIds.length,
                assessmentsDisassociated: assessmentNull.modifiedCount ?? 0,
                teacherAssessmentsDisassociated:
                    teacherAssessmentNull.modifiedCount ?? 0,
                invitationsDeleted: invitationsDelete.deletedCount ?? 0,
            },
        });
    } catch (error) {
        console.error("Error deleting classroom:", error);
        return res.status(500).json({ message: error.message });
    }
};

/**
 * DELETE /api/classrooms/:id/children/:childId
 *
 * Authorization: admin OR the classroom's lead teacher (D7). Assistant
 * teachers cannot remove children — same boundary as `deleteClassroom`.
 *
 * Semantics (single sequenced operation):
 *  1. Pull this child from `classroom.children`.
 *  2. Pull this classroom from `child.classrooms`.
 *  3. Compute "parents of this child who now have ZERO remaining
 *     children in the classroom" — those parents are pruned from
 *     `classroom.parents` and notified with a `classroom-removed`
 *     in-app notification.
 *  4. Historical assessments (Assessment + TeacherAssessment) keep
 *     their `classroomId` attribution. We do NOT rewrite past data;
 *     the classroom homepage hides pruned children's transcripts
 *     because they are no longer members, but their data still
 *     belongs to that classroom historically (D7).
 *
 * Idempotent on `child not in classroom`: returns 200 with
 * `changed:false`.
 */
export const removeChildFromClassroom = async (req, res) => {
    try {
        const { id, childId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid classroom id" });
        }
        if (!mongoose.Types.ObjectId.isValid(childId)) {
            return res.status(400).json({ message: "Invalid child id" });
        }
        if (!req.user) {
            return res.status(401).json({ message: "Authentication required" });
        }

        const classroom = await Classroom.findById(id).populate(
            "parents",
            "_id childIds"
        );
        if (!classroom) {
            return res.status(404).json({ message: "Classroom not found" });
        }

        // Admin OR lead teacher only. Assistant teachers cannot remove.
        const isAdmin = req.user.role === "admin";
        const isLead =
            req.user.role === "teacher" &&
            String(req.user.id) === String(classroom.teacher);
        if (!isAdmin && !isLead) {
            return res.status(403).json({
                message:
                    "Only admins and the lead teacher can remove children from a classroom",
            });
        }

        const childIdStr = String(childId);
        const wasMember = (classroom.children || [])
            .map((cid) => String(cid._id ?? cid))
            .includes(childIdStr);

        if (!wasMember) {
            return res.status(200).json({
                ok: true,
                changed: false,
                removedChildId: childIdStr,
                removedParents: [],
            });
        }

        // 1+2. Pull both sides.
        await Classroom.updateOne(
            { _id: classroom._id },
            { $pull: { children: new mongoose.Types.ObjectId(childIdStr) } }
        );
        await Child.updateOne(
            { _id: childIdStr },
            { $pull: { classrooms: classroom._id } }
        );

        // 3. Compute which parents are now orphaned in this classroom.
        // A parent is orphaned iff (childIds ∩ classroom.children) is empty
        // AFTER the pull above. The pulled child is the one being removed.
        const remainingChildIds = new Set(
            (classroom.children || [])
                .map((cid) => String(cid._id ?? cid))
                .filter((cid) => cid !== childIdStr)
        );
        const orphanedParents = [];
        for (const parent of classroom.parents || []) {
            const parentChildIds = (parent.childIds || []).map((cid) => String(cid));
            const stillHasChild = parentChildIds.some((cid) =>
                remainingChildIds.has(cid)
            );
            if (!stillHasChild) {
                orphanedParents.push(parent._id);
            }
        }

        if (orphanedParents.length > 0) {
            await Classroom.updateOne(
                { _id: classroom._id },
                { $pull: { parents: { $in: orphanedParents } } }
            );
            // Notify each pruned parent that they were removed.
            for (const parentId of orphanedParents) {
                await fanOutClassroomRemovedNotification({
                    classroom,
                    parentId,
                });
            }
        }

        return res.status(200).json({
            ok: true,
            changed: true,
            removedChildId: childIdStr,
            removedParents: orphanedParents.map((id) => String(id)),
        });
    } catch (error) {
        console.error("Error removing child from classroom:", error);
        return res.status(500).json({ message: error.message });
    }
};

/**
 * GET /api/classrooms/:id/transcripts
 *
 * Returns the merged set of Assessment + TeacherAssessment rows scoped
 * to this classroom, sorted by date descending. Visibility filtering
 * for non-admin callers is the same `transcriptExpiresAt > now` gate
 * used elsewhere — expired transcripts retain WPM metrics but their
 * text body is blanked out by the purge job.
 */
export const getClassroomTranscripts = async (req, res) => {
    try {
        const auth = await findAuthorizedClassroom(req, res);
        if (!auth) return;
        const { classroom, mode } = auth;

        const isAdmin = req.user?.role === "admin";
        const now = new Date();
        const visibilityFilter = isAdmin
            ? {}
            : {
                  $or: [
                      { transcriptExpiresAt: { $gt: now } },
                      {
                          $and: [
                              {
                                  $or: [
                                      { transcriptExpiresAt: { $exists: false } },
                                      { transcriptExpiresAt: null },
                                  ],
                              },
                              { transcript: { $exists: true, $nin: [null, ""] } },
                          ],
                      },
                  ],
              };

        // Parent read-only callers see only assessments tied to one of
        // their OWN children, and never teacher-side recordings.
        let childAssessmentFilter = { classroomId: classroom._id };
        let teacherAssessmentFilter = { classroomId: classroom._id };
        let includeTeacherRows = true;
        if (mode === "read") {
            const uid = String(req.user.id);
            const myChildIdSet = new Set();
            for (const p of classroom.parents || []) {
                if (String(p._id ?? p) === uid) {
                    for (const cid of p.childIds || []) {
                        myChildIdSet.add(String(cid));
                    }
                }
            }
            const myChildOids = [...myChildIdSet].map(
                (id) => new mongoose.Types.ObjectId(id)
            );
            childAssessmentFilter = {
                classroomId: classroom._id,
                childId: { $in: myChildOids },
            };
            includeTeacherRows = false;
        }

        const [childAssessments, teacherAssessments] = await Promise.all([
            Assessment.find({ ...childAssessmentFilter, ...visibilityFilter })
                .populate("childId", "name")
                .lean(),
            includeTeacherRows
                ? TeacherAssessment.find({
                      ...teacherAssessmentFilter,
                      ...visibilityFilter,
                  })
                      .populate("teacherId", "name")
                      .lean()
                : Promise.resolve([]),
        ]);

        const childRows = childAssessments.map((a) => ({
            _id: a._id,
            source: "child",
            childId: a.childId?._id ?? a.childId,
            childName: a.childId?.name ?? null,
            teacherId: null,
            teacherName: null,
            date: a.date,
            audioFileName: a.audioFileName,
            transcript: a.transcript,
            transcriptExpiresAt: a.transcriptExpiresAt,
            activity: a.activity,
            activityContext: a.activityContext,
            location: a.location,
            uploadedBy: a.uploadedBy,
            wordCount: a.wordCount,
            durationSeconds: a.durationSeconds,
            wordsPerMinute: a.wordsPerMinute,
            categoryWPM: a.categoryWPM,
            categoryWordCount: a.categoryWordCount,
            keywordCounts: a.keywordCounts,
            ragSegments: a.ragSegments,
            classificationMethod: a.classificationMethod,
        }));
        const teacherRows = teacherAssessments.map((a) => ({
            _id: a._id,
            source: "teacher",
            childId: null,
            childName: null,
            teacherId: a.teacherId?._id ?? a.teacherId,
            teacherName: a.teacherId?.name ?? null,
            date: a.date,
            audioFileName: a.audioFileName,
            transcript: a.transcript,
            transcriptExpiresAt: a.transcriptExpiresAt,
            activity: a.activity,
            activityContext: a.activityContext,
            location: a.location,
            uploadedBy: a.uploadedBy,
            wordCount: a.wordCount,
            durationSeconds: a.durationSeconds,
            wordsPerMinute: a.wordsPerMinute,
            categoryWPM: a.categoryWPM,
            categoryWordCount: a.categoryWordCount,
            keywordCounts: a.keywordCounts,
            ragSegments: a.ragSegments,
            classificationMethod: a.classificationMethod,
        }));

        const merged = [...childRows, ...teacherRows].sort((a, b) => {
            const idA = a._id != null ? String(a._id) : "";
            const idB = b._id != null ? String(b._id) : "";
            if (idA && idB && idA !== idB) {
                return idB.localeCompare(idA);
            }
            const ta = a.date ? new Date(a.date).getTime() : 0;
            const tb = b.date ? new Date(b.date).getTime() : 0;
            return tb - ta;
        });

        return res.status(200).json({
            classroomId: classroom._id,
            classroomName: classroom.name,
            recordings: merged,
            childAssessmentCount: childRows.length,
            teacherAssessmentCount: teacherRows.length,
        });
    } catch (error) {
        console.error("Error fetching classroom transcripts:", error);
        return res.status(500).json({ message: error.message });
    }
};

export const getClassroomAssessments = async (req, res) => {
    try {
        const auth = await findAuthorizedClassroom(req, res);
        if (!auth) return;
        const { classroom, mode } = auth;

        const { childIds: rosterChildIds } =
            await materializeAndSyncClassroomChildren(classroom);
        let childIds = rosterChildIds;

        // Parent read-only: restrict assessments to the parent's own
        // children so the per-child charts they're entitled to view are
        // computed against the full classroom cohort baseline of just
        // those children's rows (no other children's WPM bleed across).
        if (mode === "read") {
            const uid = String(req.user.id);
            const myChildIdSet = new Set();
            for (const p of classroom.parents || []) {
                if (String(p._id ?? p) === uid) {
                    for (const cid of p.childIds || []) {
                        myChildIdSet.add(String(cid));
                    }
                }
            }
            childIds = childIds.filter((cid) =>
                myChildIdSet.has(String(cid))
            );
        }

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
