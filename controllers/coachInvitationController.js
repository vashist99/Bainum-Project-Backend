import CoachInvitation from '../models/CoachInvitation.js';
import { Coach } from '../models/User.js';
import { sendCoachInvitationEmail } from '../lib/emailService.js';

/**
 * Send invitation to a coach. Route is admin-gated via requireCapability,
 * mirroring the teacher invitation flow.
 */
export const sendCoachInvitation = async (req, res) => {
    try {
        const { email, firstName, lastName } = req.body;
        const { id: sentBy, role: sentByRole, name: inviterName } = req.user || {};

        if (!email || !firstName || !lastName) {
            return res.status(400).json({
                message: "All fields are required: email, firstName, lastName"
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: "Invalid email format" });
        }

        const existingCoach = await Coach.findOne({ email: email.toLowerCase() });
        if (existingCoach) {
            return res.status(400).json({ message: "A coach with this email already exists" });
        }

        const existingInvitation = await CoachInvitation.findOne({
            email: email.toLowerCase(),
            status: 'pending'
        });
        if (existingInvitation && !existingInvitation.isExpired()) {
            return res.status(400).json({
                message: "A pending invitation already exists for this email"
            });
        }

        let token = CoachInvitation.generateToken();
        while (await CoachInvitation.findOne({ token })) {
            token = CoachInvitation.generateToken();
        }

        const coachInvitation = new CoachInvitation({
            email: email.toLowerCase(),
            firstName,
            lastName,
            token,
            sentBy,
            sentByRole,
            status: 'pending',
        });
        await coachInvitation.save();

        try {
            await sendCoachInvitationEmail(
                email,
                `${firstName} ${lastName}`,
                token,
                inviterName || 'Administrator'
            );
        } catch (emailError) {
            console.error('Failed to send coach invitation email:', emailError.message);
            const isProduction = process.env.NODE_ENV === 'production' ||
                process.env.RENDER ||
                !process.env.FRONTEND_URL?.includes('localhost');
            let baseUrl = process.env.FRONTEND_URL;
            if (!baseUrl || (isProduction && baseUrl.includes('localhost'))) {
                baseUrl = 'https://bainum-frontend-prod.vercel.app';
            }
            baseUrl = baseUrl.replace(/\/$/, '');
            const invitationLink = `${baseUrl}/coach/register?token=${token}`;
            return res.status(201).json({
                message: "Invitation created but email failed to send. Please share the invitation link manually.",
                invitation: {
                    id: coachInvitation._id,
                    email: coachInvitation.email,
                    token,
                    invitationLink,
                    expiresAt: coachInvitation.expiresAt
                },
                warning: "Email not configured. Please share this invitation link with the coach manually.",
                emailError: emailError.message
            });
        }

        res.status(201).json({
            message: "Coach invitation sent successfully",
            invitation: {
                id: coachInvitation._id,
                email: coachInvitation.email,
                expiresAt: coachInvitation.expiresAt
            }
        });
    } catch (error) {
        console.error("Error sending coach invitation:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/** Verify coach invitation token (public — used by the register page). */
export const verifyCoachInvitation = async (req, res) => {
    try {
        const { token } = req.params;
        if (!token) {
            return res.status(400).json({ message: "Invitation token is required" });
        }

        const invitation = await CoachInvitation.findOne({ token });
        if (!invitation) {
            return res.status(404).json({ message: "Invalid invitation token" });
        }
        if (invitation.status === 'accepted') {
            return res.status(400).json({ message: "This invitation has already been accepted" });
        }
        if (invitation.isExpired()) {
            invitation.status = 'expired';
            await invitation.save();
            return res.status(400).json({ message: "This invitation has expired" });
        }
        if (invitation.status !== 'pending') {
            return res.status(400).json({ message: "This invitation is no longer valid" });
        }

        res.status(200).json({
            valid: true,
            invitation: {
                email: invitation.email,
                firstName: invitation.firstName,
                lastName: invitation.lastName,
                expiresAt: invitation.expiresAt
            }
        });
    } catch (error) {
        console.error("Error verifying coach invitation:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/** Get all coach invitations (admin dashboard). */
export const getCoachInvitations = async (req, res) => {
    try {
        const invitations = await CoachInvitation.find({}).sort({ createdAt: -1 });
        res.status(200).json({
            invitations: invitations.map(inv => ({
                id: inv._id,
                email: inv.email,
                firstName: inv.firstName,
                lastName: inv.lastName,
                status: inv.status,
                expiresAt: inv.expiresAt,
                createdAt: inv.createdAt,
                acceptedAt: inv.acceptedAt
            }))
        });
    } catch (error) {
        console.error("Error fetching coach invitations:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};
