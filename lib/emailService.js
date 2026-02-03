import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// Load environment variables (if not already loaded by server)
dotenv.config();

// Create reusable transporter
const createTransporter = () => {
    // Check if email credentials are configured (trim whitespace)
    const emailUser = process.env.EMAIL_USER?.trim();
    const emailPassword = process.env.EMAIL_PASSWORD?.trim();
    const emailAppPassword = process.env.EMAIL_APP_PASSWORD?.trim();
    
    if (!emailUser || (!emailPassword && !emailAppPassword)) {
        const error = new Error('Email credentials not configured. Please set EMAIL_USER and EMAIL_PASSWORD (or EMAIL_APP_PASSWORD) in your environment variables.');
        error.code = 'EMAIL_CONFIG_MISSING';
        throw error;
    }

    // In production, configure with your email service credentials
    const transporter = nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
            user: emailUser,
            pass: emailAppPassword || emailPassword, // Prefer App Password for Gmail
        },
        // Add connection timeout and other options for better reliability
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 10000,
        socketTimeout: 10000,
    });
    
    return transporter;
};

/**
 * Send invitation email to parent
 * @param {string} email - Parent's email address
 * @param {string} childName - Name of the child
 * @param {string} invitationToken - Unique invitation token
 * @param {string} inviterName - Name of the person sending the invitation
 * @returns {Promise<Object>} Email send result
 */
export const sendInvitationEmail = async (email, childName, invitationToken, inviterName) => {
    let transporter;
    try {
        transporter = createTransporter();
        
        // Verify connection before sending (helps catch config issues early)
        try {
            await transporter.verify();
        } catch (verifyError) {
            console.error('Email transporter verification failed:', {
                code: verifyError.code,
                command: verifyError.command,
                response: verifyError.response,
                responseCode: verifyError.responseCode
            });
            throw new Error(`Email service connection failed: ${verifyError.message}. Please check your email credentials.`);
        }
        
        // Create invitation link - prioritize production URL
        // Check for production environment indicators
        const isProduction = process.env.NODE_ENV === 'production' || 
                            process.env.RENDER || 
                            !process.env.FRONTEND_URL?.includes('localhost');
        
        let baseUrl = process.env.FRONTEND_URL;
        
        // If no FRONTEND_URL is set in production, use the production frontend URL
        if (!baseUrl || (isProduction && baseUrl.includes('localhost'))) {
            baseUrl = 'https://bainum-frontend-prod.vercel.app';
        }
        
        // Ensure baseUrl doesn't have trailing slash
        baseUrl = baseUrl.replace(/\/$/, '');
        
        const invitationLink = `${baseUrl}/parent/register?token=${invitationToken}`;

        const mailOptions = {
            from: `"${process.env.EMAIL_FROM_NAME || 'Bainum Project'}" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Invitation to View ${childName}'s Progress`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
                        .content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 5px 5px; }
                        .button { display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Parent Portal Invitation</h1>
                        </div>
                        <div class="content">
                            <p>Hello,</p>
                            <p>You have been invited by <strong>${inviterName}</strong> to view your child <strong>${childName}</strong>'s progress and assessments.</p>
                            <p>Click the button below to create your account and access your child's data:</p>
                            <div style="text-align: center;">
                                <a href="${invitationLink}" class="button">Accept Invitation</a>
                            </div>
                            <p>Or copy and paste this link into your browser:</p>
                            <p style="word-break: break-all; color: #4F46E5;">${invitationLink}</p>
                            <p><strong>Note:</strong> This invitation link will expire in 7 days.</p>
                            <p>If you did not expect this invitation, please ignore this email.</p>
                        </div>
                        <div class="footer">
                            <p>This is an automated message from the Bainum Project system.</p>
                        </div>
                    </div>
                </body>
                </html>
            `,
            text: `
                Parent Portal Invitation

                Hello,

                You have been invited by ${inviterName} to view your child ${childName}'s progress and assessments.

                Click the link below to create your account and access your child's data:

                ${invitationLink}

                Note: This invitation link will expire in 7 days.

                If you did not expect this invitation, please ignore this email.

                This is an automated message from the Bainum Project system.
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', {
            to: email,
            messageId: info.messageId,
            response: info.response
        });
        return { success: true, messageId: info.messageId };
    } catch (error) {
        // Enhanced error logging for debugging
        const errorDetails = {
            message: error.message,
            code: error.code,
            command: error.command,
            response: error.response,
            responseCode: error.responseCode,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        };
        console.error('Error sending invitation email:', errorDetails);
        
        // Provide more specific error messages
        if (error.code === 'EMAIL_CONFIG_MISSING') {
            throw new Error('Email service is not configured. Please contact the administrator.');
        } else if (error.code === 'EAUTH' || error.responseCode === 535) {
            throw new Error('Email authentication failed. Please check email credentials.');
        } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
            throw new Error('Email service connection failed. Please try again later.');
        } else {
            throw new Error(`Failed to send invitation email: ${error.message}`);
        }
    }
};

/**
 * Send invitation email to teacher
 * @param {string} email - Teacher's email address
 * @param {string} teacherName - Name of the teacher
 * @param {string} invitationToken - Unique invitation token
 * @param {string} inviterName - Name of the person sending the invitation
 * @returns {Promise<Object>} Email send result
 */
export const sendTeacherInvitationEmail = async (email, teacherName, invitationToken, inviterName) => {
    let transporter;
    try {
        transporter = createTransporter();
        
        // Verify connection before sending (helps catch config issues early)
        try {
            await transporter.verify();
        } catch (verifyError) {
            console.error('Email transporter verification failed:', {
                code: verifyError.code,
                command: verifyError.command,
                response: verifyError.response,
                responseCode: verifyError.responseCode
            });
            throw new Error(`Email service connection failed: ${verifyError.message}. Please check your email credentials.`);
        }
        
        // Create invitation link - prioritize production URL
        const isProduction = process.env.NODE_ENV === 'production' || 
                            process.env.RENDER || 
                            !process.env.FRONTEND_URL?.includes('localhost');
        
        let baseUrl = process.env.FRONTEND_URL;
        
        // If no FRONTEND_URL is set in production, use the production frontend URL
        if (!baseUrl || (isProduction && baseUrl.includes('localhost'))) {
            baseUrl = 'https://bainum-frontend-prod.vercel.app';
        }
        
        // Ensure baseUrl doesn't have trailing slash
        baseUrl = baseUrl.replace(/\/$/, '');
        
        const invitationLink = `${baseUrl}/teacher/register?token=${invitationToken}`;

        const mailOptions = {
            from: `"${process.env.EMAIL_FROM_NAME || 'Bainum Project'}" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Invitation to Join Bainum Project as a Teacher`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
                        .content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 5px 5px; }
                        .button { display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Teacher Invitation</h1>
                        </div>
                        <div class="content">
                            <p>Hello ${teacherName},</p>
                            <p>You have been invited by <strong>${inviterName}</strong> to join the Bainum Project as a teacher.</p>
                            <p>Click the button below to create your account and get started:</p>
                            <div style="text-align: center;">
                                <a href="${invitationLink}" class="button">Accept Invitation</a>
                            </div>
                            <p>Or copy and paste this link into your browser:</p>
                            <p style="word-break: break-all; color: #4F46E5;">${invitationLink}</p>
                            <p><strong>Note:</strong> This invitation link will expire in 7 days.</p>
                            <p>If you did not expect this invitation, please ignore this email.</p>
                        </div>
                        <div class="footer">
                            <p>This is an automated message from the Bainum Project system.</p>
                        </div>
                    </div>
                </body>
                </html>
            `,
            text: `
                Teacher Invitation

                Hello ${teacherName},

                You have been invited by ${inviterName} to join the Bainum Project as a teacher.

                Click the link below to create your account and get started:

                ${invitationLink}

                Note: This invitation link will expire in 7 days.

                If you did not expect this invitation, please ignore this email.

                This is an automated message from the Bainum Project system.
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Teacher invitation email sent successfully:', {
            to: email,
            messageId: info.messageId,
            response: info.response
        });
        return { success: true, messageId: info.messageId };
    } catch (error) {
        // Enhanced error logging for debugging
        const errorDetails = {
            message: error.message,
            code: error.code,
            command: error.command,
            response: error.response,
            responseCode: error.responseCode,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        };
        console.error('Error sending teacher invitation email:', errorDetails);
        
        // Provide more specific error messages
        if (error.code === 'EMAIL_CONFIG_MISSING') {
            throw new Error('Email service is not configured. Please contact the administrator.');
        } else if (error.code === 'EAUTH' || error.responseCode === 535) {
            throw new Error('Email authentication failed. Please check email credentials.');
        } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
            throw new Error('Email service connection failed. Please try again later.');
        } else {
            throw new Error(`Failed to send teacher invitation email: ${error.message}`);
        }
    }
};

/**
 * Verify email configuration
 * @returns {Promise<boolean>} True if email is configured
 */
export const verifyEmailConfig = async () => {
    try {
        if (!process.env.EMAIL_USER || (!process.env.EMAIL_PASSWORD && !process.env.EMAIL_APP_PASSWORD)) {
            return false;
        }
        const transporter = createTransporter();
        await transporter.verify();
        return true;
    } catch (error) {
        return false;
    }
};

