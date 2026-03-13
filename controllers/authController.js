import { Admin, Teacher, Parent, Child } from "../models/User.js";
import Invitation from "../models/Invitation.js";
import TeacherInvitation from "../models/TeacherInvitation.js";
import PasswordReset from "../models/PasswordReset.js";
import { sendPasswordResetEmail } from "../lib/emailService.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const validateUsername = (u) => /^[a-z0-9_]{3,30}$/.test((u || '').toLowerCase().trim());

export const register = async (req, res) => {
    try {
        const { name, email, password, role, username } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({ message: "Name, email, password, and role are required" });
        }

        if (!username || !validateUsername(username)) {
            return res.status(400).json({ message: "Username is required (3-30 chars, lowercase letters, numbers, underscore only)" });
        }
        const cleanUsername = username.toLowerCase().trim();

        if (!name || !email || !password || !role) {
            return res.status(400).json({ message: "Name, email, password, and role are required" });
        }

        // Determine which model to use based on role
        let UserModel;
        if (role === "admin") {
            UserModel = Admin;
        } else if (role === "teacher") {
            UserModel = Teacher;
        } else {
            return res.status(400).json({ message: "Invalid role" });
        }

        // Check if user already exists
        const existingUser = await UserModel.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "User already exists" });
        }

        const existingByUsername = await UserModel.findOne({ username: cleanUsername });
        if (existingByUsername) {
            return res.status(400).json({ message: "Username is already taken" });
        }

        // Hash password before saving
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create new user
        const user = new UserModel({
            name,
            email,
            username: cleanUsername,
            role,
            password: hashedPassword,
        });

        const payload = {
            id: user._id,
            name: user.name,
            email: user.email,
            username: user.username,
            role: user.role,
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

        await user.save();

        res.status(201).json({
            token
        });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ message: error.message });
    }
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({ 
                message: "Email and password are required" 
            });
        }


        // Try to find user in Admin, Teacher, and Parent collections
        let user = await Admin.findOne({ email });
        let userType = 'admin';
        
        if (!user) {
            user = await Teacher.findOne({ email });
            userType = 'teacher';
        }
        
        if (!user) {
            user = await Parent.findOne({ email });
            userType = 'parent';
        }
        
        if (!user) {
            return res.status(401).json({ message: "Invalid email or password" });
        }


        // Check if parent account is activated
        if (user.role === 'parent' && !user.invitationAccepted) {
            return res.status(401).json({ 
                message: "Please complete your registration using the invitation link" 
            });
        }

        // Compare password - support both hashed (bcrypt) and plain text (for migration)
        let isPasswordValid = false;
        
        // Check if password is hashed (bcrypt hashes start with $2a$, $2b$, or $2y$)
        if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$') || user.password.startsWith('$2y$')) {
            // Password is hashed, use bcrypt.compare
            isPasswordValid = await bcrypt.compare(password, user.password);
            
            // If password is valid and was plain text before, hash it now for future logins
            if (isPasswordValid) {
                // Password is already hashed, no need to update
            }
        } else {
            // Password is plain text (legacy), compare directly
            isPasswordValid = (user.password === password);
            
            // If password is valid, hash it and update the database for future logins
            if (isPasswordValid) {
                const saltRounds = 10;
                const hashedPassword = await bcrypt.hash(password, saltRounds);
                user.password = hashedPassword;
                await user.save();
            }
        }
        
        if (!isPasswordValid) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        // Include username for profile URLs (teachers)
        const userResponse = {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role,
            username: user.username || undefined,
        };

        if (user.role === 'parent' && user.childId) {
            // Convert ObjectId to string for JSON serialization
            userResponse.childId = user.childId.toString ? user.childId.toString() : String(user.childId);
        }

        const token = jwt.sign(userResponse, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });


        res.status(200).json({
            message: "Login successful",
            user: token,
        });
    } catch (error) {
        console.error("Login error:", error);
        console.error("Error stack:", error.stack);
        res.status(500).json({ 
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Register parent with invitation token
 */
export const registerParent = async (req, res) => {
    try {
        const { name, email, password, invitationToken, username } = req.body;

        // Validate required fields
        if (!name || !email || !password || !invitationToken) {
            return res.status(400).json({ 
                message: "Name, email, password, and invitation token are required" 
            });
        }

        if (!username || !validateUsername(username)) {
            return res.status(400).json({ message: "Username is required (3-30 chars, lowercase letters, numbers, underscore only)" });
        }
        const cleanUsername = username.toLowerCase().trim();

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                message: "Invalid email format" 
            });
        }

        // Validate password length
        if (password.length < 6) {
            return res.status(400).json({ 
                message: "Password must be at least 6 characters" 
            });
        }

        // Verify invitation token
        const invitation = await Invitation.findOne({ token: invitationToken })
            .populate('childId');

        if (!invitation) {
            return res.status(404).json({ 
                message: "Invalid invitation token" 
            });
        }

        if (invitation.status === 'accepted') {
            return res.status(400).json({ 
                message: "This invitation has already been used" 
            });
        }

        if (invitation.isExpired()) {
            invitation.status = 'expired';
            await invitation.save();
            return res.status(400).json({ 
                message: "This invitation has expired" 
            });
        }

        // Verify email matches invitation
        if (invitation.email.toLowerCase() !== email.toLowerCase()) {
            return res.status(400).json({ 
                message: "Email does not match the invitation" 
            });
        }

        // Check if parent already exists
        const existingParent = await Parent.findOne({ email });
        if (existingParent) {
            return res.status(400).json({ 
                message: "An account with this email already exists" 
            });
        }

        const existingByUsername = await Parent.findOne({ username: cleanUsername });
        if (existingByUsername) {
            return res.status(400).json({ message: "Username is already taken" });
        }

        // Hash password before saving
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create parent account
        const parent = new Parent({
            name,
            email,
            username: cleanUsername,
            password: hashedPassword,
            role: 'parent',
            childId: invitation.childId._id,
            invitationToken: invitationToken,
            invitationAccepted: true
        });

        await parent.save();

        const userResponse = {
            id: parent._id.toString(),
            name: parent.name,
            email: parent.email,
            username: parent.username,
            role: parent.role,
            childId: parent.childId?.toString?.() || String(parent.childId),
        };
        const token = jwt.sign(userResponse, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

        // Update invitation status
        invitation.status = 'accepted';
        invitation.acceptedAt = new Date();
        await invitation.save();

        // Update child's parents array
        await Child.findByIdAndUpdate(
            invitation.childId._id,
            { $addToSet: { parents: parent._id } }
        );

        res.status(201).json({
            message: "Parent account created successfully",
            user: token,
        });
    } catch (error) {
        console.error("Parent registration error:", error);
        res.status(500).json({ 
            message: error.message || "Internal server error" 
        });
    }
};

/**
 * Register teacher with invitation token
 */
export const registerTeacher = async (req, res) => {
    try {
        const { password, invitationToken, username } = req.body;

        // Validate required fields
        if (!password || !invitationToken) {
            return res.status(400).json({ 
                message: "Password and invitation token are required" 
            });
        }

        if (!username || !validateUsername(username)) {
            return res.status(400).json({ message: "Username is required (3-30 chars, lowercase letters, numbers, underscore only)" });
        }
        const cleanUsername = username.toLowerCase().trim();

        // Validate password length
        if (password.length < 6) {
            return res.status(400).json({ 
                message: "Password must be at least 6 characters" 
            });
        }

        // Verify invitation token
        const invitation = await TeacherInvitation.findOne({ token: invitationToken });

        if (!invitation) {
            return res.status(404).json({ 
                message: "Invalid invitation token" 
            });
        }

        if (invitation.status === 'accepted') {
            return res.status(400).json({ 
                message: "This invitation has already been used" 
            });
        }

        if (invitation.isExpired()) {
            invitation.status = 'expired';
            await invitation.save();
            return res.status(400).json({ 
                message: "This invitation has expired" 
            });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Check if teacher already exists (e.g. added via "Add Teacher" then invited to set password)
        let teacher = await Teacher.findOne({ email: invitation.email.toLowerCase() });

        if (teacher) {
            // Existing teacher: update password and optionally username (for "Invite" flow on Teachers page)
            const existingByUsername = await Teacher.findOne({ username: cleanUsername });
            if (existingByUsername && existingByUsername._id.toString() !== teacher._id.toString()) {
                return res.status(400).json({ message: "Username is already taken" });
            }
            teacher.password = hashedPassword;
            teacher.username = cleanUsername;
            // Optionally refresh details from invitation
            teacher.name = `${invitation.firstName} ${invitation.lastName}`;
            teacher.center = invitation.center || teacher.center;
            teacher.education = invitation.education || teacher.education;
            teacher.dateOfBirth = invitation.dateOfBirth || teacher.dateOfBirth;
            await teacher.save();
        } else {
            // New teacher: create account
            const existingByUsername = await Teacher.findOne({ username: cleanUsername });
            if (existingByUsername) {
                return res.status(400).json({ message: "Username is already taken" });
            }

            teacher = new Teacher({
                name: `${invitation.firstName} ${invitation.lastName}`,
                email: invitation.email.toLowerCase(),
                username: cleanUsername,
                password: hashedPassword,
                role: 'teacher',
                center: invitation.center,
                education: invitation.education,
                dateOfBirth: invitation.dateOfBirth
            });

            await teacher.save();
        }

        const userResponse = {
            id: teacher._id.toString(),
            name: teacher.name,
            email: teacher.email,
            username: teacher.username,
            role: teacher.role,
        };

        const token = jwt.sign(userResponse, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

        // Update invitation status
        invitation.status = 'accepted';
        invitation.acceptedAt = new Date();
        await invitation.save();

        res.status(201).json({
            message: "Teacher account created successfully",
            user: token,
        });
    } catch (error) {
        console.error("Teacher registration error:", error);
        res.status(500).json({ 
            message: error.message || "Internal server error" 
        });
    }
};

/**
 * Forgot password - send reset email if account exists
 * Uses generic success message to avoid email enumeration
 */
export const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !email.trim()) {
            return res.status(400).json({ message: "Email is required" });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            return res.status(400).json({ message: "Invalid email format" });
        }
        const normalizedEmail = email.trim().toLowerCase();

        // Find user in Admin, Teacher, Parent
        let user = await Admin.findOne({ email: normalizedEmail });
        let userType = "admin";
        if (!user) {
            user = await Teacher.findOne({ email: normalizedEmail });
            userType = "teacher";
        }
        if (!user) {
            user = await Parent.findOne({ email: normalizedEmail });
            userType = "parent";
        }

        // Generic success - don't reveal if email exists
        const genericMessage = "If an account exists with that email, you will receive password reset instructions shortly.";

        if (!user) {
            return res.status(200).json({ message: genericMessage });
        }

        // Invalidate any existing reset tokens for this email
        await PasswordReset.deleteMany({ email: normalizedEmail });

        const token = PasswordReset.generateToken();
        await PasswordReset.create({
            email: normalizedEmail,
            token,
            userType,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        });

        try {
            await sendPasswordResetEmail(normalizedEmail, token);
        } catch (emailError) {
            console.error("Failed to send password reset email:", emailError);
            await PasswordReset.deleteOne({ token });
            return res.status(500).json({
                message: "Failed to send reset email. Please try again later.",
            });
        }

        return res.status(200).json({ message: genericMessage });
    } catch (error) {
        console.error("Forgot password error:", error);
        res.status(500).json({ message: "An error occurred. Please try again." });
    }
};

/**
 * Reset password with token
 */
export const resetPassword = async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ message: "Token and new password are required" });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters" });
        }

        const resetRecord = await PasswordReset.findOne({ token });
        if (!resetRecord) {
            return res.status(400).json({ message: "Invalid or expired reset link" });
        }
        if (resetRecord.usedAt) {
            return res.status(400).json({ message: "This reset link has already been used" });
        }
        if (resetRecord.isExpired()) {
            await PasswordReset.deleteOne({ token });
            return res.status(400).json({ message: "This reset link has expired. Please request a new one." });
        }

        let UserModel;
        if (resetRecord.userType === "admin") UserModel = Admin;
        else if (resetRecord.userType === "teacher") UserModel = Teacher;
        else UserModel = Parent;

        const user = await UserModel.findOne({ email: resetRecord.email });
        if (!user) {
            await PasswordReset.deleteOne({ token });
            return res.status(400).json({ message: "Invalid or expired reset link" });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        user.password = hashedPassword;
        await user.save();

        resetRecord.usedAt = new Date();
        await resetRecord.save();

        return res.status(200).json({ message: "Password reset successfully. You can now sign in with your new password." });
    } catch (error) {
        console.error("Reset password error:", error);
        res.status(500).json({ message: "An error occurred. Please try again." });
    }
};