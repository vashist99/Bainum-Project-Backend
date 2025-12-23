import { Admin, Teacher, Parent, Child } from "../models/User.js";
import Invitation from "../models/Invitation.js";
import TeacherInvitation from "../models/TeacherInvitation.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

export const register = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        // Determine which model to use based on role
        let UserModel;
        if (role === "admin") {
            UserModel = Admin;
        } else if (role === "teacher") {
            UserModel = Teacher;
        } else {
            return res.status(400).json({ message: "Invalid role" });
        }

        // Check if user already exists (only for Admin and Teacher which have email)
        if (role === "admin" || role === "teacher") {
            const existingUser = await UserModel.findOne({ email });
            if (existingUser) {
                return res.status(400).json({ message: "User already exists" });
            }
        }

        // Hash password before saving
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create new user
        const user = new UserModel({
            name,
            email,  
            role,
            password: hashedPassword,
        });

        const payload = {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

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

        console.log(`Login attempt for email: ${email}`);

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
            console.log(`User not found: ${email}`);
            return res.status(401).json({ message: "Invalid email or password" });
        }

        console.log(`User found: ${userType}, role: ${user.role}`);

        // Check if parent account is activated
        if (user.role === 'parent' && !user.invitationAccepted) {
            console.log(`Parent account not activated: ${email}`);
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
                console.log(`Migrated password to bcrypt for user: ${email}`);
            }
        }
        
        if (!isPasswordValid) {
            console.log(`Invalid password for: ${email}`);
            return res.status(401).json({ message: "Invalid email or password" });
        }

        // For parents, include childId in response
        const userResponse = {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role,
        };

        if (user.role === 'parent' && user.childId) {
            // Convert ObjectId to string for JSON serialization
            userResponse.childId = user.childId.toString ? user.childId.toString() : String(user.childId);
        }

        const token = jwt.sign(userResponse, process.env.JWT_SECRET, { expiresIn: '1h' });

        console.log(`Login successful for: ${email}, role: ${user.role}`);

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
        const { name, email, password, invitationToken } = req.body;

        // Validate required fields
        if (!name || !email || !password || !invitationToken) {
            return res.status(400).json({ 
                message: "Name, email, password, and invitation token are required" 
            });
        }

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

        // Hash password before saving
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create parent account
        const parent = new Parent({
            name,
            email,
            password: hashedPassword,
            role: 'parent',
            childId: invitation.childId._id,
            invitationToken: invitationToken,
            invitationAccepted: true
        });

        await parent.save();

        const token = jwt.sign(parent, process.env.JWT_SECRET, { expiresIn: '1h' });

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
        const { password, invitationToken } = req.body;

        // Validate required fields
        if (!password || !invitationToken) {
            return res.status(400).json({ 
                message: "Password and invitation token are required" 
            });
        }

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

        // Check if teacher already exists
        const existingTeacher = await Teacher.findOne({ email: invitation.email.toLowerCase() });
        if (existingTeacher) {
            return res.status(400).json({ 
                message: "An account with this email already exists" 
            });
        }

        // Hash password before saving
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create teacher account using details from invitation
        const teacher = new Teacher({
            name: `${invitation.firstName} ${invitation.lastName}`,
            email: invitation.email.toLowerCase(),
            password: hashedPassword,
            role: 'teacher',
            center: invitation.center,
            education: invitation.education,
            dateOfBirth: invitation.dateOfBirth
        });

        await teacher.save();

        const userResponse = {
            id: teacher._id.toString(),
            name: teacher.name,
            email: teacher.email,
            role: teacher.role,
        };

        const token = jwt.sign(userResponse, process.env.JWT_SECRET, { expiresIn: '1h' });

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