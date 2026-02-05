import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import dotenv from 'dotenv';

// Load environment variables (if not already loaded by server)
dotenv.config();

// Initialize Resend if API key is provided (preferred for production/cloud hosting)
let resend = null;
if (process.env.RESEND_API_KEY?.trim()) {
    try {
        resend = new Resend(process.env.RESEND_API_KEY.trim());
        console.log('Resend API initialized successfully');
    } catch (error) {
        console.error('Failed to initialize Resend:', error);
    }
} else {
    console.log('Resend API key not found, will use SMTP fallback');
}

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

    // Use explicit SMTP configuration for better reliability, especially in production
    // Try port 465 (SSL) first, fallback to 587 (STARTTLS) if needed
    const useSSL = process.env.EMAIL_PORT === '465' || !process.env.EMAIL_PORT;
    
    const smtpConfig = {
        host: 'smtp.gmail.com',
        port: useSSL ? 465 : 587,
        secure: useSSL, // true for 465, false for other ports
        auth: {
            user: emailUser,
            pass: emailAppPassword || emailPassword, // Prefer App Password for Gmail
        },
        // Increased timeouts for Render's network
        connectionTimeout: 60000, // 60 seconds
        greetingTimeout: 30000,
        socketTimeout: 60000,
        // Retry configuration
        pool: false, // Disable pooling to avoid connection issues
        // Additional options for reliability
        tls: {
            // Do not fail on invalid certs (some networks have issues)
            rejectUnauthorized: false,
            minVersion: 'TLSv1.2'
        },
        // Debug mode in development
        debug: process.env.NODE_ENV === 'development',
        logger: process.env.NODE_ENV === 'development'
    };
    
    const transporter = nodemailer.createTransport(smtpConfig);
    
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

    // Use Resend API if available (recommended for production/cloud hosting)
    console.log('Email service check:', {
        hasResend: !!resend,
        hasResendKey: !!process.env.RESEND_API_KEY,
        resendKeyLength: process.env.RESEND_API_KEY?.length || 0,
        nodeEnv: process.env.NODE_ENV,
        isRender: !!process.env.RENDER
    });
    
    if (resend) {
        console.log('Using Resend API to send email');
        try {
            const htmlContent = `
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
            `;

            const textContent = `
                Parent Portal Invitation

                Hello,

                You have been invited by ${inviterName} to view your child ${childName}'s progress and assessments.

                Click the link below to create your account and access your child's data:

                ${invitationLink}

                Note: This invitation link will expire in 7 days.

                If you did not expect this invitation, please ignore this email.

                This is an automated message from the Bainum Project system.
            `;

            const fromEmail = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_USER || 'onboarding@resend.dev';
            const fromName = process.env.EMAIL_FROM_NAME || 'Bainum Project';

            console.log('Attempting to send email via Resend:', {
                from: `${fromName} <${fromEmail}>`,
                to: email,
                hasResend: !!resend
            });

            const data = await resend.emails.send({
                from: `${fromName} <${fromEmail}>`,
                to: [email],
                subject: `Invitation to View ${childName}'s Progress`,
                html: htmlContent,
                text: textContent,
            });

            console.log('Email sent successfully via Resend:', {
                to: email,
                id: data.id,
                data: data
            });
            
            if (!data.id) {
                throw new Error('Resend API returned success but no email ID. Email may not have been sent.');
            }
            
            return { success: true, messageId: data.id };
        } catch (error) {
            console.error('Resend API error details:', {
                message: error.message,
                name: error.name,
                response: error.response,
                status: error.status,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
            throw new Error(`Failed to send invitation email via Resend: ${error.message || 'Unknown error'}`);
        }
    }

    // Fallback to SMTP (for local development)
    // WARNING: SMTP often fails on cloud hosting like Render due to blocked ports
    const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;
    if (isProduction && !resend) {
        console.error('CRITICAL: Attempting to use SMTP in production without Resend API key.');
        console.error('SMTP will likely fail on Render. Please set RESEND_API_KEY environment variable.');
        throw new Error('Email service not configured for production. Please set RESEND_API_KEY environment variable. SMTP connections are blocked on Render.');
    }
    
    console.log('Using SMTP fallback (local development only)');
    let transporter;
    try {
        transporter = createTransporter();
        
        // Skip verification in production to avoid timeout issues
        if (process.env.NODE_ENV === 'development') {
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
        }

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
        } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT' || error.code === 'ETIMEOUT') {
            throw new Error('Email service connection timeout. Render may be blocking SMTP connections. Consider using a third-party email service like SendGrid or Mailgun.');
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

    // Use Resend API if available (recommended for production/cloud hosting)
    if (resend) {
        try {
            const htmlContent = `
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
            `;

            const textContent = `
                Teacher Invitation

                Hello ${teacherName},

                You have been invited by ${inviterName} to join the Bainum Project as a teacher.

                Click the link below to create your account and get started:

                ${invitationLink}

                Note: This invitation link will expire in 7 days.

                If you did not expect this invitation, please ignore this email.

                This is an automated message from the Bainum Project system.
            `;

            const fromEmail = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_USER || 'onboarding@resend.dev';
            const fromName = process.env.EMAIL_FROM_NAME || 'Bainum Project';

            console.log('Attempting to send teacher invitation via Resend:', {
                from: `${fromName} <${fromEmail}>`,
                to: email,
                hasResend: !!resend
            });

            const data = await resend.emails.send({
                from: `${fromName} <${fromEmail}>`,
                to: [email],
                subject: `Invitation to Join Bainum Project as a Teacher`,
                html: htmlContent,
                text: textContent,
            });

            console.log('Teacher invitation email sent successfully via Resend:', {
                to: email,
                id: data.id,
                data: data
            });
            
            if (!data.id) {
                throw new Error('Resend API returned success but no email ID. Email may not have been sent.');
            }
            
            return { success: true, messageId: data.id };
        } catch (error) {
            console.error('Resend API error details:', {
                message: error.message,
                name: error.name,
                response: error.response,
                status: error.status,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
            throw new Error(`Failed to send teacher invitation email via Resend: ${error.message || 'Unknown error'}`);
        }
    }

    // Fallback to SMTP (for local development)
    // WARNING: SMTP often fails on cloud hosting like Render due to blocked ports
    const isProductionTeacher = process.env.NODE_ENV === 'production' || process.env.RENDER;
    if (isProductionTeacher && !resend) {
        console.error('CRITICAL: Attempting to use SMTP in production without Resend API key.');
        console.error('SMTP will likely fail on Render. Please set RESEND_API_KEY environment variable.');
        throw new Error('Email service not configured for production. Please set RESEND_API_KEY environment variable. SMTP connections are blocked on Render.');
    }
    
    console.log('Using SMTP fallback for teacher invitation (local development only)');
    let transporter;
    try {
        transporter = createTransporter();
        
        // Skip verification in production to avoid timeout issues
        if (process.env.NODE_ENV === 'development') {
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
        } else {
            // In production, warn that SMTP may not work
            console.warn('Using SMTP in production - this may fail due to network restrictions. Consider using Resend API.');
        }

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
        } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT' || error.code === 'ETIMEOUT') {
            throw new Error('Email service connection timeout. Render may be blocking SMTP connections. Consider using a third-party email service like SendGrid or Mailgun.');
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

