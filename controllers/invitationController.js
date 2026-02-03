import Invitation from '../models/Invitation.js';
import { Child } from '../models/User.js';
import { sendInvitationEmail } from '../lib/emailService.js';
import jwt from 'jsonwebtoken';

/**
 * Send invitation to parent
 * Only admins and teachers can send invitations
 */
export const sendInvitation = async (req, res) => {
    try {
        const { email, childId } = req.body;
        const { id: sentBy, role: sentByRole, name: inviterName } = req.user || {};

        // Validate user is admin or teacher
        if (!sentBy || (sentByRole !== 'admin' && sentByRole !== 'teacher')) {
            return res.status(403).json({ 
                message: "Only admins and teachers can send invitations" 
            });
        }

        // Validate required fields
        if (!email || !childId) {
            return res.status(400).json({ 
                message: "Email and child ID are required" 
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                message: "Invalid email format" 
            });
        }

        // Verify child exists
        const child = await Child.findById(childId);
        if (!child) {
            return res.status(404).json({ 
                message: "Child not found" 
            });
        }

        // Check if there's already a pending invitation for this email and child
        const existingInvitation = await Invitation.findOne({
            email,
            childId,
            status: 'pending'
        });

        if (existingInvitation && !existingInvitation.isExpired()) {
            return res.status(400).json({ 
                message: "A pending invitation already exists for this email and child" 
            });
        }

        // Generate unique token
        let token = Invitation.generateToken();
        let tokenExists = await Invitation.findOne({ token });
        
        // Ensure token is unique
        while (tokenExists) {
            token = Invitation.generateToken();
            tokenExists = await Invitation.findOne({ token });
        }

        // Create invitation
        const invitation = new Invitation({
            email,
            childId,
            token,
            sentBy,
            sentByRole,
            status: 'pending',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        });

        const payload = {
            id: invitation._id,
            email: invitation.email,
            childId: invitation.childId,
            token: invitation.token,
            sentBy: invitation.sentBy,
            sentByRole: invitation.sentByRole,
            status: invitation.status,
        };

        const invitationToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

        await invitation.save();

        // Send invitation email
        try {
            await sendInvitationEmail(email, child.name, token, inviterName || 'Administrator');
        } catch (emailError) {
            console.error('Failed to send email, but invitation created:', emailError);
            
            // Create invitation link for manual sharing
            const isProduction = process.env.NODE_ENV === 'production' || 
                                process.env.RENDER || 
                                !process.env.FRONTEND_URL?.includes('localhost');
            let baseUrl = process.env.FRONTEND_URL;
            if (!baseUrl || (isProduction && baseUrl.includes('localhost'))) {
                baseUrl = 'https://bainum-frontend-prod.vercel.app';
            }
            baseUrl = baseUrl.replace(/\/$/, '');
            const invitationLink = `${baseUrl}/parent/register?token=${token}`;
            
            // Still return success, but note email issue and include the link
            return res.status(201).json({
                message: "Invitation created but email failed to send. Please share the invitation link manually.",
                invitation: {
                    id: invitation._id,
                    email: invitation.email,
                    token: invitationToken, // Include token in case email fails
                    invitationLink: invitationLink, // Include full link for manual sharing
                    expiresAt: invitation.expiresAt
                },
                warning: "Email not configured. Please share this invitation link with the parent manually.",
                emailError: process.env.NODE_ENV === 'development' ? emailError.message : undefined
            });
        }

        res.status(201).json({
            message: "Invitation sent successfully",
            invitation: {
                id: invitation._id,
                email: invitation.email,
                expiresAt: invitation.expiresAt
            }
        });
    } catch (error) {
        console.error("Error sending invitation:", error);
        res.status(500).json({ 
            message: error.message || "Internal server error" 
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
                message: "Invitation token is required" 
            });
        }

        const invitation = await Invitation.findOne({ token }).populate('childId');

        if (!invitation) {
            return res.status(404).json({ 
                message: "Invalid invitation token" 
            });
        }

        if (invitation.status === 'accepted') {
            return res.status(400).json({ 
                message: "This invitation has already been accepted" 
            });
        }

        if (invitation.isExpired()) {
            invitation.status = 'expired';
            await invitation.save();
            return res.status(400).json({ 
                message: "This invitation has expired" 
            });
        }

        // Return invitation details (without sensitive info)
        res.status(200).json({
            valid: true,
            invitation: {
                email: invitation.email,
                childId: invitation.childId._id,
                childName: invitation.childId.name,
                expiresAt: invitation.expiresAt
            }
        });
    } catch (error) {
        console.error("Error verifying invitation:", error);
        res.status(500).json({ 
            message: error.message || "Internal server error" 
        });
    }
};

/**
 * Get all invitations (for admin/teacher dashboard)
 */
export const getInvitations = async (req, res) => {
    try {
        const { id: userId, role: userRole } = req.user || {};

        if (!userId || (userRole !== 'admin' && userRole !== 'teacher')) {
            return res.status(403).json({ 
                message: "Only admins and teachers can view invitations" 
            });
        }

        // Admins can see all, teachers see only their own
        const query = userRole === 'admin' 
            ? {} 
            : { sentBy: userId };

        const invitations = await Invitation.find(query)
            .populate('childId', 'name')
            .sort({ createdAt: -1 });

        res.status(200).json({
            invitations: invitations.map(inv => ({
                id: inv._id,
                email: inv.email,
                childName: inv.childId.name,
                childId: inv.childId._id,
                status: inv.status,
                expiresAt: inv.expiresAt,
                createdAt: inv.createdAt,
                acceptedAt: inv.acceptedAt
            }))
        });
    } catch (error) {
        console.error("Error fetching invitations:", error);
        res.status(500).json({ 
            message: error.message || "Internal server error" 
        });
    }
};

