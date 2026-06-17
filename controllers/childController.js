import mongoose from "mongoose";
import { Child, Teacher, Parent } from "../models/User.js";
import Classroom from "../models/Classroom.js";
import { hasActiveTeacherChildGrant } from "../lib/accessGrantHelpers.js";
import {
    getResolvedChildIdStringsForParent,
    parentMayAccessChild,
} from "../lib/parentChildHelpers.js";
import { getSupervisedChildrenForTeacher } from "../lib/teacherChildHelpers.js";
import { readSchoolFromBody, withSchoolField, mapSchoolCollection } from "../lib/schoolFieldAlias.js";
import {
    enrichChildClassroomsFromRosters,
    hydrateClassroomNamesOnChildren,
} from "../lib/classroomMembershipSync.js";

const CLASSROOM_POPULATE = { path: "classrooms", select: "name" };

/** Serialize classroom refs as `{ _id, name }` for API responses. */
function formatClassroomRefs(classrooms) {
    if (!Array.isArray(classrooms)) return [];
    return classrooms
        .map((room) => {
            if (room == null) return null;
            if (typeof room === "object") {
                const id = room._id ?? room.id;
                if (!id) return null;
                const name =
                    typeof room.name === "string" && room.name.trim()
                        ? room.name.trim()
                        : "Unknown classroom";
                return { _id: id, name };
            }
            return { _id: room, name: "Unknown classroom" };
        })
        .filter(Boolean);
}

function childWithPopulatedClassrooms(child) {
    const plain = withSchoolField(child);
    plain.classrooms = formatClassroomRefs(plain.classrooms);
    return plain;
}

function childApiPayload(child) {
    return withSchoolField({
        id: child._id,
        name: child.name,
        role: child.role,
        dateOfBirth: child.dateOfBirth,
        gender: child.gender,
        diagnosis: child.diagnosis,
        primaryLanguage: child.primaryLanguage,
        center: child.center,
        classrooms: formatClassroomRefs(child.classrooms),
    });
}

export const createChild = async (req, res) => {
    try {
        const school = readSchoolFromBody(req.body);

        if (!name || !dateOfBirth || !gender || !diagnosis || !primaryLanguage || !school) {
            return res.status(400).json({ message: "All fields are required" });
        }

        const dob = new Date(dateOfBirth);
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 8);
        if (isNaN(dob.getTime()) || dob < cutoff) {
            return res.status(400).json({ message: "Child must be 8 years old or younger" });
        }

        const child = new Child({
            name,
            role: "child",
            dateOfBirth,
            gender,
            diagnosis,
            primaryLanguage,
            center: school,
            classrooms: [],
        });

        await child.save();

        res.status(201).json({
            message: "Child created successfully",
            child: childApiPayload(child),
        });
    } catch (error) {
        console.error("Error creating child:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getAllChildren = async (req, res) => {
    try {
        const user = req.user;
        const linkedOnly = req.query?.linkedToAcceptedParent === "true" || req.query?.linkedToAcceptedParent === "1";

        if (user?.role === "admin") {
            if (linkedOnly) {
                const acceptedParentIds = await Parent.find({ invitationAccepted: true }).distinct("_id");
                const children = await Child.find({
                    parents: { $in: acceptedParentIds },
                }).populate(CLASSROOM_POPULATE);
                await hydrateClassroomNamesOnChildren(children);
                return res.status(200).json({
                    children: mapSchoolCollection(children).map(childWithPopulatedClassrooms),
                });
            }
            const children = await Child.find().populate(CLASSROOM_POPULATE);
            await hydrateClassroomNamesOnChildren(children);
            return res.status(200).json({
                children: mapSchoolCollection(children).map(childWithPopulatedClassrooms),
            });
        }
        if (user?.role === "teacher") {
            const teacher = await Teacher.findById(user.id);
            if (!teacher) {
                return res.status(200).json({ children: [] });
            }
            // List all children supervised by this teacher (lead or assistant
            // in any classroom, plus any active AccessGrants). Used for the
            // teacher's invite-children picker; the full child page still
            // gates on a per-child AccessGrant.
            const children = await getSupervisedChildrenForTeacher(teacher);
            await hydrateClassroomNamesOnChildren(children);
            return res.status(200).json({
                children: mapSchoolCollection(children).map(childWithPopulatedClassrooms),
            });
        }
        if (user?.role === "parent") {
            const parent = await Parent.findById(user.id);
            if (!parent) {
                return res.status(404).json({ message: "Parent not found" });
            }
            const idStrs = await getResolvedChildIdStringsForParent(parent);
            if (idStrs.length === 0) {
                return res.status(200).json({ children: [] });
            }
            const oids = idStrs.map((s) => new mongoose.Types.ObjectId(s));
            const children = await Child.find({ _id: { $in: oids } }).populate(CLASSROOM_POPULATE);
            await hydrateClassroomNamesOnChildren(children);
            return res.status(200).json({
                children: mapSchoolCollection(children).map(childWithPopulatedClassrooms),
            });
        }
        const children = await Child.find().populate(CLASSROOM_POPULATE);
        await hydrateClassroomNamesOnChildren(children);
        res.status(200).json({
            children: mapSchoolCollection(children).map(childWithPopulatedClassrooms),
        });
    } catch (error) {
        console.error("Error fetching children:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getChildById = async (req, res) => {
    try {
        const child = await Child.findById(req.params.id)
            .populate("parents", "name email")
            .populate(CLASSROOM_POPULATE);
        
        if (!child) {
            return res.status(404).json({ message: "Child not found" });
        }

        await enrichChildClassroomsFromRosters(child);

        if (req.user && req.user.role === "parent") {
            const parent = await Parent.findById(req.user.id);
            if (!parent) {
                return res.status(404).json({ message: "Parent not found" });
            }
            const ok = await parentMayAccessChild(parent, child._id);
            if (!ok) {
                return res.status(403).json({ message: "You don't have access to this child's data" });
            }
        }

        if (req.user?.role === "teacher") {
            const teacher = await Teacher.findById(req.user.id);
            const hasGrant = await hasActiveTeacherChildGrant(req.user.id, child._id);
            if (hasGrant) {
                return res.status(200).json({ child: childWithPopulatedClassrooms(child) });
            }
            // "Supervises this child" means: this teacher is the lead or
            // assistant on at least one classroom the child is enrolled in.
            // Drives the "send invitation" CTA on the teacher-side child page.
            let supervises = false;
            if (teacher && Array.isArray(child.classrooms) && child.classrooms.length > 0) {
                const classroomIds = child.classrooms.map((r) => r?._id ?? r);
                const supervised = await Classroom.exists({
                    _id: { $in: classroomIds },
                    $or: [{ teacher: teacher._id }, { assistantTeacher: teacher._id }],
                });
                supervises = !!supervised;
            }
            if (supervises) {
                return res.status(403).json({
                    code: "TEACHER_ACCESS_DENIED",
                    message:
                        "The parent must accept your invitation (or approve access) before you can view this child's full data. You can send an invitation to the parent's email below.",
                    child: childWithPopulatedClassrooms({
                        _id: child._id,
                        name: child.name,
                        center: child.center,
                        classrooms: child.classrooms,
                    }),
                });
            }
            return res.status(403).json({ message: "You do not have access to this child's data" });
        }
        
        res.status(200).json({ child: childWithPopulatedClassrooms(child) });
    } catch (error) {
        console.error("Error fetching child:", error);
        res.status(500).json({ message: error.message });
    }
};

export const updateChild = async (req, res) => {
    try {
        const { name, dateOfBirth, gender, diagnosis, primaryLanguage } = req.body;
        const { id } = req.params;
        const school = readSchoolFromBody(req.body);

        if (!name || !dateOfBirth || !gender || !diagnosis || !primaryLanguage || !school) {
            return res.status(400).json({ message: "All fields are required" });
        }

        const dob = new Date(dateOfBirth);
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 8);
        if (isNaN(dob.getTime()) || dob < cutoff) {
            return res.status(400).json({ message: "Child must be 8 years old or younger" });
        }

        const child = await Child.findById(id);
        if (!child) {
            return res.status(404).json({ message: "Child not found" });
        }

        child.name = name;
        child.dateOfBirth = dateOfBirth;
        child.gender = gender;
        child.diagnosis = diagnosis;
        child.primaryLanguage = primaryLanguage;
        child.center = school;

        await child.save();

        res.status(200).json({
            message: "Child updated successfully",
            child: childApiPayload(child),
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
