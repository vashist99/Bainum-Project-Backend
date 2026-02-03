import TeacherInvitation from '../models/TeacherInvitation.js';
import { Teacher } from '../models/User.js';
import { sendTeacherInvitationEmail } from '../lib/emailService.js';

/**
 * Send invitation to teacher
 * Only admins can send teacher invitations
 */
export const sendTeacherInvitation = async (req, res) => {
    try {
        const { email, firstName, lastName, education, dateOfBirth, center } = req.body;
        
        // Debug: Log the full req.user object to see what we're getting
        console.log('Teacher invitation request - req.user:', JSON.stringify(req.user, null, 2));
        console.log('Teacher invitation request - req.user type:', typeof req.user);
        console.log('Teacher invitation request - req.user keys:', req.user ? Object.keys(req.user) : 'null');
        
        const { id: sentBy, role: sentByRole, name: inviterName } = req.user || {};

        // Debug: Log extracted values
        console.log('Extracted values:', {
            sentBy,
            sentByRole,
            inviterName,
            hasId: !!sentBy,
            hasRole: !!sentByRole,
            roleValue: sentByRole,
            roleType: typeof sentByRole,
            roleIsAdmin: sentByRole === 'admin'
        });

        // Validate user is admin
        if (!sentBy || sentByRole !== 'admin') {
            console.log('403 Error - User validation failed:', {
                hasId: !!sentBy,
                hasRole: !!sentByRole,
                roleValue: sentByRole,
                expectedRole: 'admin',
                roleMatch: sentByRole === 'admin'
            });
            return res.status(403).json({ 
                message: "Only admins can send teacher invitations",
                debug: process.env.NODE_ENV === 'development' ? {
                    hasId: !!sentBy,
                    hasRole: !!sentByRole,
                    roleValue: sentByRole,
                    userObject: req.user
                } : undefined
            });
        }

        // Validate required fields
        if (!email || !firstName || !lastName || !education || !dateOfBirth || !center) {
            return res.status(400).json({ 
                message: "All fields are required: email, firstName, lastName, education, dateOfBirth, center" 
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                message: "Invalid email format" 
            });
        }

        // Check if teacher with this email already exists
        // Allow invitations for existing teachers (for re-invitation or account recovery)
        const existingTeacher = await Teacher.findOne({ email: email.toLowerCase() });
        if (existingTeacher) {
            console.log(`Teacher ${email} already exists. Allowing re-invitation.`);
            // Continue - allow re-invitation for existing teachers
        }

        // Check if there's already a pending invitation for this email
        const existingInvitation = await TeacherInvitation.findOne({
            email: email.toLowerCase(),
            status: 'pending'
        });

        if (existingInvitation && !existingInvitation.isExpired()) {
            return res.status(400).json({ 
                message: "A pending invitation already exists for this email" 
            });
        }

        // Generate unique token
        let token = TeacherInvitation.generateToken();
        let tokenExists = await TeacherInvitation.findOne({ token });
        
        // Ensure token is unique
        while (tokenExists) {
            token = TeacherInvitation.generateToken();
            tokenExists = await TeacherInvitation.findOne({ token });
        }

        // Create invitation
        const teacherInvitation = new TeacherInvitation({
            email: email.toLowerCase(),
            firstName,
            lastName,
            education,
            dateOfBirth: new Date(dateOfBirth),
            center,
            token,
            sentBy,
            sentByRole,
            status: 'pending',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        });

        await teacherInvitation.save();

        // Send invitation email
        try {
            await sendTeacherInvitationEmail(
                email, 
                `${firstName} ${lastName}`, 
                token, 
                inviterName || 'Administrator'
            );
            console.log(`Teacher invitation sent to ${email}`);
        } catch (emailError) {
            console.error('Failed to send email, but invitation created:', emailError);
            
            // Create invitation link for manual sharing
            const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            const invitationLink = `${baseUrl}/teacher/register?token=${token}`;
            
            // Still return success, but note email issue and include the link
            return res.status(201).json({
                message: "Invitation created but email failed to send. Please share the invitation link manually.",
                invitation: {
                    id: teacherInvitation._id,
                    email: teacherInvitation.email,
                    token: token,
                    invitationLink: invitationLink,
                    expiresAt: teacherInvitation.expiresAt
                },
                warning: "Email not configured. Please share this invitation link with the teacher manually.",
                emailError: process.env.NODE_ENV === 'development' ? emailError.message : undefined
            });
        }

        res.status(201).json({
            message: "Teacher invitation sent successfully",
            invitation: {
                id: teacherInvitation._id,
                email: teacherInvitation.email,
                expiresAt: teacherInvitation.expiresAt
            }
        });
    } catch (error) {
        console.error("Error sending teacher invitation:", error);
        res.status(500).json({ 
            message: error.message || "Internal server error" 
        });
    }
};

/**
 * Verify teacher invitation token
 * Used when teacher clicks invitation link
 */
export const verifyTeacherInvitation = async (req, res) => {
    try {
        const { token } = req.params;

        if (!token) {
            return res.status(400).json({ 
                message: "Invitation token is required" 
            });
        }

        const invitation = await TeacherInvitation.findOne({ token });

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

        // Check if invitation is still pending (valid)
        if (invitation.status !== 'pending') {
            return res.status(400).json({ 
                message: "This invitation is no longer valid" 
            });
        }

        // Return invitation details (without sensitive info)
        res.status(200).json({
            valid: true,
            invitation: {
                email: invitation.email,
                firstName: invitation.firstName,
                lastName: invitation.lastName,
                education: invitation.education,
                dateOfBirth: invitation.dateOfBirth,
                center: invitation.center,
                expiresAt: invitation.expiresAt
            }
        });
    } catch (error) {
        console.error("Error verifying teacher invitation:", error);
        res.status(500).json({ 
            message: error.message || "Internal server error" 
        });
    }
};

/**
 * Get all teacher invitations (for admin dashboard)
 */
export const getTeacherInvitations = async (req, res) => {
    try {
        const { id: userId, role: userRole } = req.user || {};

        if (!userId || userRole !== 'admin') {
            return res.status(403).json({ 
                message: "Only admins can view teacher invitations" 
            });
        }

        const invitations = await TeacherInvitation.find({})
            .sort({ createdAt: -1 });

        res.status(200).json({
            invitations: invitations.map(inv => ({
                id: inv._id,
                email: inv.email,
                firstName: inv.firstName,
                lastName: inv.lastName,
                education: inv.education,
                dateOfBirth: inv.dateOfBirth,
                center: inv.center,
                status: inv.status,
                expiresAt: inv.expiresAt,
                createdAt: inv.createdAt,
                acceptedAt: inv.acceptedAt
            }))
        });
    } catch (error) {
        console.error("Error fetching teacher invitations:", error);
        res.status(500).json({ 
            message: error.message || "Internal server error" 
        });
    }
};
