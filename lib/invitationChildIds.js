import mongoose from "mongoose";

/**
 * Ordered unique child ids for an invitation (supports legacy `childId` only or `childIds` multi).
 * @param {import("mongoose").Document | object} inv
 * @returns {mongoose.Types.ObjectId[]}
 */
export function resolveInvitationChildIds(inv) {
    if (!inv) return [];
    const out = [];
    const seen = new Set();
    const pushId = (raw) => {
        if (raw == null) return;
        const id = raw._id != null ? raw._id : raw;
        const s = String(id);
        if (seen.has(s)) return;
        seen.add(s);
        out.push(id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(s));
    };
    if (Array.isArray(inv.childIds) && inv.childIds.length) {
        for (const c of inv.childIds) pushId(c);
    }
    if (inv.childId != null) pushId(inv.childId);
    return out;
}
