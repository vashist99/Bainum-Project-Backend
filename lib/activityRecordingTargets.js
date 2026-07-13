import mongoose from "mongoose";
import { Teacher, Parent, Child } from "../models/User.js";
import { getResolvedChildIdStringsForParent } from "./parentChildHelpers.js";

/**
 * Resolve child documents for a "Record Activity" transcribe/accept request.
 *  - parent: exactly one linked child (childId required).
 *  - teacher: no child targets — the recording is saved to the teacher's
 *    own profile only (classroom talk is never copied onto child records).
 */
export async function resolveActivityRecordingTargets(user, childId = null) {
    if (user.role === "parent") {
        const parent = await Parent.findById(user.id);
        if (!parent) return { error: { status: 404, message: "Parent not found" } };
        const idStrs = await getResolvedChildIdStringsForParent(parent);
        if (idStrs.length === 0) {
            return {
                error: {
                    status: 400,
                    message:
                        "You don't have any children linked to your account yet. Accept an invitation before recording.",
                },
            };
        }

        const rawChildId = String(childId || "").trim();
        if (!rawChildId) {
            return {
                error: {
                    status: 400,
                    message: "Please select a child to record for.",
                },
            };
        }
        if (!idStrs.includes(rawChildId)) {
            return {
                error: {
                    status: 403,
                    message: "You can only record for your own linked children.",
                },
            };
        }

        const child = await Child.findById(rawChildId);
        if (!child) {
            return { error: { status: 404, message: "Child not found." } };
        }
        return { children: [child], context: "home" };
    }

    if (user.role === "teacher") {
        const teacher = await Teacher.findById(user.id);
        if (!teacher) return { error: { status: 404, message: "Teacher not found" } };
        return { children: [], context: "school" };
    }

    return {
        error: {
            status: 403,
            message: "Only teachers and parents can record activities for their children.",
        },
    };
}

/**
 * Resolve parent accept targets from an explicit childId (same rules as transcribe).
 */
export async function resolveParentAcceptTarget(parent, childId) {
    const idStrs = await getResolvedChildIdStringsForParent(parent);
    if (idStrs.length === 0) {
        return { error: { status: 400, message: "No children linked to your account." } };
    }
    const rawChildId = String(childId || "").trim();
    if (!rawChildId) {
        return { error: { status: 400, message: "Please select a child to record for." } };
    }
    if (!idStrs.includes(rawChildId)) {
        return {
            error: { status: 403, message: "You can only record for your own linked children." },
        };
    }
    const oids = [new mongoose.Types.ObjectId(rawChildId)];
    const children = await Child.find({ _id: { $in: oids } });
    if (children.length === 0) {
        return { error: { status: 404, message: "Child not found." } };
    }
    return { children };
}
