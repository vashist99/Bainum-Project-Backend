import mongoose from "mongoose";
import Invitation from "../models/Invitation.js";
import { Child, Parent } from "../models/User.js";
import {
    guardSingleParentInviteAcceptance,
} from "../lib/parentChildHelpers.js";
import { sendInvitationEmail } from "../lib/emailService.js";
import { fetchEnactCheckEmail } from "../lib/enactEmailCheck.js";
import { resolveInvitationChildIds } from "../lib/invitationChildIds.js";
import jwt from "jsonwebtoken";

function normalizeChildIdsFromBody(body) {
    const { childId, childIds } = body;
    const out = [];
    if (Array.isArray(childIds) && childIds.length) {
        for (const x of childIds) {
            if (x != null && String(x).trim()) out.push(String(x).trim());
        }
    }
    if (childId != null && String(childId).trim()) {
        out.push(String(childId).trim());
    }
    return [...new Set(out)];
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Non-expired pending invitation for this parent email (case-insensitive). */
async function findPendingInvitationForEmailNorm(emailNorm) {
    const invs = await Invitation.find({
        status: "pending",
        expiresAt: { $gt: new Date() },
    });
    return invs.find((i) => String(i.email).toLowerCase() === emailNorm) || null;
}

async function setInvitedParentEmailOnChildren(oidList, emailNorm) {
    await Child.updateMany({ _id: { $in: oidList } }, { $set: { invitedParentEmail: emailNorm } });
}

/**
 * Send invitation to parent (one email, one token; may cover multiple children)
 * Only admins and teachers can send invitations
 */
export const sendInvitation = async (req, res) => {
    try {
        const { email } = req.body;
        const uniqueOrdered = normalizeChildIdsFromBody(req.body);
        const { id: sentBy, role: sentByRole, name: inviterName } = req.user || {};

        if (!sentBy || (sentByRole !== "admin" && sentByRole !== "teacher")) {
            return res.status(403).json({
                message: "Only admins and teachers can send invitations",
            });
        }

        if (!email || uniqueOrdered.length === 0) {
            return res.status(400).json({
                message: "Email and at least one child ID are required",
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                message: "Invalid email format",
            });
        }

        const emailNorm = email.trim().toLowerCase();
        const parentForEmail = await Parent.findOne({
            email: new RegExp(`^${escapeRegex(emailNorm)}$`, "i"),
        });

        for (const id of uniqueOrdered) {
            if (!mongoose.Types.ObjectId.isValid(id)) {
                return res.status(400).json({ message: `Invalid child ID: ${id}` });
            }
        }

        const childDocs = [];
        for (const id of uniqueOrdered) {
            const child = await Child.findById(id);
            if (!child) {
                return res.status(404).json({
                    message: `Child not found: ${id}`,
                });
            }
            if (Array.isArray(child.parents) && child.parents.length > 0) {
                return res.status(400).json({
                    message: `${child.name}: this child already has a parent linked in the database. Invitation is disabled.`,
                });
            }
            const inviteGuard = guardSingleParentInviteAcceptance(child, parentForEmail?._id);
            if (!inviteGuard.ok) {
                return res.status(400).json({
                    message: `${child.name}: ${inviteGuard.message}`,
                });
            }
            childDocs.push(child);
        }

        const oidList = uniqueOrdered.map((id) => new mongoose.Types.ObjectId(id));

        const invsAll = await Invitation.find({
            status: "pending",
            expiresAt: { $gt: new Date() },
        });
        for (const inv of invsAll) {
            if (String(inv.email).toLowerCase() === emailNorm) continue;
            const taken = resolveInvitationChildIds(inv).map(String);
            for (const sid of uniqueOrdered) {
                if (taken.includes(String(sid))) {
                    return res.status(400).json({
                        message:
                            "One or more selected children already have a pending parent invitation sent to a different email address.",
                    });
                }
            }
        }

        let pendingInv = await findPendingInvitationForEmailNorm(emailNorm);
        if (pendingInv) {
            const beforeSet = new Set(resolveInvitationChildIds(pendingInv).map(String));
            const mergedIds = resolveInvitationChildIds(pendingInv).map(
                (x) => new mongoose.Types.ObjectId(x)
            );
            let added = 0;
            for (const sid of uniqueOrdered) {
                if (!beforeSet.has(String(sid))) {
                    beforeSet.add(String(sid));
                    mergedIds.push(new mongoose.Types.ObjectId(sid));
                    added += 1;
                }
            }
            pendingInv.childIds = mergedIds;
            pendingInv.childId = mergedIds[0];
            pendingInv.email = emailNorm;
            await pendingInv.save();
            await setInvitedParentEmailOnChildren(oidList, emailNorm);
            return res.status(200).json({
                message:
                    added > 0
                        ? `Added ${added} child(ren) to the existing invitation for this email. No email was sent — the parent can use their original invitation link.`
                        : "These children are already included in a pending invitation for this email. Parent contact email saved on each child.",
                mergedWithPending: true,
                emailSent: false,
                invitationId: pendingInv._id,
            });
        }

        let token = Invitation.generateToken();
        let tokenExists = await Invitation.findOne({ token });
        while (tokenExists) {
            token = Invitation.generateToken();
            tokenExists = await Invitation.findOne({ token });
        }

        const enactCheck = await fetchEnactCheckEmail(email);
        const enactExistsForPartner = !enactCheck.ok || enactCheck.exists;
        const enactEmailExists = enactCheck.ok === true && enactCheck.exists === true;

        const invitation = new Invitation({
            email: emailNorm,
            childId: oidList[0],
            childIds: oidList,
            token,
            sentBy,
            sentByRole,
            status: "pending",
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            enactEmailExists,
        });

        const payload = {
            id: invitation._id,
            email: invitation.email,
            childId: invitation.childId,
            childIds: oidList,
            token: invitation.token,
            sentBy: invitation.sentBy,
            sentByRole: invitation.sentByRole,
            status: invitation.status,
        };

        const invitationToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });

        await invitation.save();
        await setInvitedParentEmailOnChildren(oidList, emailNorm);

        const partnerAppUrl =
            enactExistsForPartner ? undefined : process.env.EXTERNAL_APP_URL?.trim() || undefined;
        if (!enactExistsForPartner && !partnerAppUrl) {
            console.warn(
                "[Invitation] Enact reports email not registered but EXTERNAL_APP_URL is unset; sending standard invite only"
            );
        }

        const nameList = childDocs.map((c) => c.name);

        try {
            await sendInvitationEmail(email, nameList, token, inviterName || "Administrator", {
                partnerAppUrl,
                enactEmailExists,
            });
        } catch (emailError) {
            console.error("Failed to send email, but invitation created:", {
                error: emailError.message,
                code: emailError.code,
                email: email,
                childNames: nameList,
            });

            const isProduction =
                process.env.NODE_ENV === "production" ||
                process.env.RENDER ||
                !process.env.FRONTEND_URL?.includes("localhost");
            let baseUrl = process.env.FRONTEND_URL;
            if (!baseUrl || (isProduction && baseUrl.includes("localhost"))) {
                baseUrl = "https://bainum-frontend-prod.vercel.app";
            }
            baseUrl = baseUrl.replace(/\/$/, "");
            const invitationLink = `${baseUrl}/parent/register?token=${token}`;

            return res.status(201).json({
                message:
                    "Invitation created but email failed to send. Please share the invitation link manually.",
                invitation: {
                    id: invitation._id,
                    email: invitation.email,
                    token: invitationToken,
                    invitationLink: invitationLink,
                    expiresAt: invitation.expiresAt,
                },
                warning: "Email not configured. Please share this invitation link with the parent manually.",
                emailError: emailError.message,
                emailSent: false,
            });
        }

        res.status(201).json({
            message: "Invitation sent successfully",
            emailSent: true,
            invitation: {
                id: invitation._id,
                email: invitation.email,
                expiresAt: invitation.expiresAt,
                childIds: oidList,
            },
        });
    } catch (error) {
        console.error("Error sending invitation:", error);
        res.status(500).json({
            message: error.message || "Internal server error",
        });
    }
};

/**
 * Verify invitation token
 * Used when parent clicks invitation link
 */
export const verifyInvitation = async (req, res) => {
    try {
        const { token } = req.params;

        if (!token) {
            return res.status(400).json({
                message: "Invitation token is required",
            });
        }

        const invitation = await Invitation.findOne({ token })
            .populate("childId")
            .populate("childIds");

        if (!invitation) {
            console.log("[Invitation] Verify failed: token not found in DB", {
                tokenLength: token?.length,
                hasAuthHeader: !!req.headers?.authorization,
            });
            return res.status(404).json({
                message: "Invalid invitation token",
            });
        }

        if (invitation.status === "accepted") {
            return res.status(400).json({
                message: "This invitation has already been accepted",
            });
        }

        if (invitation.isExpired()) {
            invitation.status = "expired";
            await invitation.save();
            return res.status(400).json({
                message: "This invitation has expired",
            });
        }

        const ids = resolveInvitationChildIds(invitation);
        const childDocs = await Child.find({ _id: { $in: ids } })
            .select("name")
            .lean();
        const nameById = new Map(childDocs.map((d) => [String(d._id), d.name]));
        const children = ids.map((oid) => ({
            id: oid,
            name: nameById.get(String(oid)) || "Child",
        }));

        const first = children[0];
        console.log("[Invitation] Verify success", {
            childIds: ids.map(String),
            email: invitation.email,
        });

        res.status(200).json({
            valid: true,
            invitation: {
                email: invitation.email,
                childId: first?.id,
                childName: first?.name,
                childIds: children.map((c) => c.id),
                children,
                expiresAt: invitation.expiresAt,
            },
        });
    } catch (error) {
        console.error("Error verifying invitation:", error);
        res.status(500).json({
            message: error.message || "Internal server error",
        });
    }
};

/**
 * Get all invitations (for admin/teacher dashboard)
 */
export const getInvitations = async (req, res) => {
    try {
        const { id: userId, role: userRole } = req.user || {};

        if (!userId || (userRole !== "admin" && userRole !== "teacher")) {
            return res.status(403).json({
                message: "Only admins and teachers can view invitations",
            });
        }

        const query = userRole === "admin" ? {} : { sentBy: userId };

        const invitations = await Invitation.find(query)
            .populate("childId", "name")
            .populate("childIds", "name")
            .sort({ createdAt: -1 });

        res.status(200).json({
            invitations: invitations.map((inv) => {
                const ids = resolveInvitationChildIds(inv);
                const names = ids.map((oid) => {
                    const fromMulti = inv.childIds?.find(
                        (c) => c != null && String(c._id || c) === String(oid)
                    );
                    const doc =
                        fromMulti ||
                        (inv.childId != null &&
                        String(inv.childId?._id || inv.childId) === String(oid)
                            ? inv.childId
                            : null);
                    return doc?.name || "—";
                });
                return {
                    id: inv._id,
                    email: inv.email,
                    childName: names.length === 1 ? names[0] : names.join(", "),
                    childId: ids[0] || inv.childId?._id,
                    childIds: ids,
                    status: inv.status,
                    expiresAt: inv.expiresAt,
                    createdAt: inv.createdAt,
                    acceptedAt: inv.acceptedAt,
                };
            }),
        });
    } catch (error) {
        console.error("Error fetching invitations:", error);
        res.status(500).json({
            message: error.message || "Internal server error",
        });
    }
};
