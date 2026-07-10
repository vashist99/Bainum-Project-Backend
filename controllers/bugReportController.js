import { buildBugReportEmailPayload } from "../lib/bugReportEmail.js";
import { sendBugReportEmail } from "../lib/emailService.js";

// Single-address check: no commas/semicolons/whitespace, so a reporter
// can't smuggle extra recipients or headers through the address field.
const EMAIL_REGEX = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

const MAX_TITLE = 150;
const MAX_TEXT = 5000;
const MAX_PAGE_OR_FEATURE = 300;
const MAX_USER_AGENT = 500;

// Per-user throttle: the global IP limiter (100 req/min) is far too
// permissive for an endpoint that emails arbitrary addresses. In-memory
// is fine at current single-instance deployment; a restart resetting the
// window is not a meaningful abuse vector at this rate.
export const THROTTLE_MAX_REPORTS = 3;
export const THROTTLE_WINDOW_MS = 10 * 60 * 1000;
const reportTimestampsByUser = new Map();

export function throttleCheck(userId, now = Date.now()) {
    const cutoff = now - THROTTLE_WINDOW_MS;
    const recent = (reportTimestampsByUser.get(userId) || []).filter((t) => t > cutoff);
    if (recent.length >= THROTTLE_MAX_REPORTS) {
        reportTimestampsByUser.set(userId, recent);
        return { allowed: false, retryAfterMs: recent[0] + THROTTLE_WINDOW_MS - now };
    }
    recent.push(now);
    reportTimestampsByUser.set(userId, recent);
    return { allowed: true };
}

/** Test hook: clear the in-memory throttle state. */
export function resetBugReportThrottle() {
    reportTimestampsByUser.clear();
}

// ES module named imports can't be stubbed by node:test's mock.method,
// so the sender is routed through an injectable reference for tests.
let sendReportEmail = sendBugReportEmail;

/** Test hook: replace (or restore, with no argument) the email sender. */
export function setBugReportEmailSenderForTests(fn) {
    sendReportEmail = fn || sendBugReportEmail;
}

function trimmedString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function validateBody(body) {
    const recipientEmail = trimmedString(body?.recipientEmail);
    const title = trimmedString(body?.title);
    const description = trimmedString(body?.description);
    const stepsToReproduce = trimmedString(body?.stepsToReproduce);
    const pageOrFeature = trimmedString(body?.pageOrFeature);

    if (!recipientEmail || !EMAIL_REGEX.test(recipientEmail)) {
        return { error: "Please provide a single valid recipient email address" };
    }
    if (!title) return { error: "Title is required" };
    if (title.length > MAX_TITLE) return { error: `Title must be at most ${MAX_TITLE} characters` };
    if (!description) return { error: "Description is required" };
    if (description.length > MAX_TEXT) return { error: `Description must be at most ${MAX_TEXT} characters` };
    if (stepsToReproduce.length > MAX_TEXT) return { error: `Steps to reproduce must be at most ${MAX_TEXT} characters` };
    if (pageOrFeature.length > MAX_PAGE_OR_FEATURE) return { error: `"Where did this happen" must be at most ${MAX_PAGE_OR_FEATURE} characters` };

    return {
        value: {
            recipientEmail,
            title,
            description,
            stepsToReproduce: stepsToReproduce || undefined,
            pageOrFeature: pageOrFeature || undefined,
            userAgent: trimmedString(body?.userAgent).slice(0, MAX_USER_AGENT) || undefined,
        },
    };
}

/**
 * POST /api/bug-reports — email a user-submitted bug report to the
 * address the reporter entered. Reporter identity comes from the JWT.
 */
export const submitBugReport = async (req, res) => {
    try {
        const user = req.user;
        const { error, value } = validateBody(req.body);
        if (error) {
            return res.status(400).json({ message: error });
        }

        const throttle = throttleCheck(String(user.id));
        if (!throttle.allowed) {
            return res.status(429).json({
                message: "You have sent several bug reports recently. Please wait a few minutes and try again.",
                retryAfter: Math.ceil(throttle.retryAfterMs / 1000),
            });
        }

        const payload = buildBugReportEmailPayload({
            title: value.title,
            description: value.description,
            stepsToReproduce: value.stepsToReproduce,
            pageOrFeature: value.pageOrFeature,
            reporter: { name: user.name, role: user.role, email: user.email },
            userAgent: value.userAgent,
            submittedAt: new Date(),
        });

        try {
            await sendReportEmail(value.recipientEmail, payload);
        } catch (sendError) {
            console.error("submitBugReport: email send failed:", sendError.message);
            return res.status(502).json({
                message: sendError.message || "Failed to send the bug report email. Please try again.",
            });
        }

        return res.status(200).json({
            message: `Bug report sent to ${value.recipientEmail}`,
        });
    } catch (error) {
        console.error("submitBugReport:", error);
        return res.status(500).json({ message: error.message || "Internal server error" });
    }
};
