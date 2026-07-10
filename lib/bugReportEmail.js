/**
 * Pure builder for the bug report email. Kept separate from
 * emailService.js (which owns provider selection/transport) so the
 * content — including HTML escaping of user input — is unit-testable.
 */

export function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const ORIGIN_BANNER =
    "This bug report was submitted by a signed-in user of the Bainum dashboard and sent to this address at their request.";

/**
 * @param {{
 *   title: string,
 *   description: string,
 *   stepsToReproduce?: string,
 *   pageOrFeature?: string,
 *   reporter: { name?: string, role?: string, email?: string },
 *   userAgent?: string,
 *   submittedAt?: Date,
 * }} report
 * @returns {{ subject: string, htmlContent: string, textContent: string }}
 */
export function buildBugReportEmailPayload(report) {
    const {
        title,
        description,
        stepsToReproduce,
        pageOrFeature,
        reporter = {},
        userAgent,
        submittedAt = new Date(),
    } = report || {};

    const subject = `[Bug Report] ${title} — Bainum Dashboard`;
    const timestamp = submittedAt.toISOString();
    const reporterLine = `${reporter.name || "Unknown user"} (${reporter.role || "unknown role"}, ${reporter.email || "no email on file"})`;

    const htmlSection = (label, value) => `
                            <h3 style="margin-bottom: 4px;">${label}</h3>
                            <p style="white-space: pre-wrap; margin-top: 0;">${escapeHtml(value)}</p>`;

    const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
                        .banner { background-color: #FEF3C7; border: 1px solid #F59E0B; padding: 10px 14px; border-radius: 5px; font-size: 13px; margin-bottom: 16px; }
                        .content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 5px 5px; }
                        .meta { color: #666; font-size: 12px; border-top: 1px solid #e5e7eb; margin-top: 20px; padding-top: 12px; }
                        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Bug Report</h1>
                        </div>
                        <div class="content">
                            <div class="banner">${ORIGIN_BANNER}</div>
                            <p><strong>Reported by:</strong> ${escapeHtml(reporterLine)}</p>
${htmlSection("Title", title)}
${htmlSection("Description", description)}${stepsToReproduce ? htmlSection("Steps to reproduce", stepsToReproduce) : ""}${pageOrFeature ? htmlSection("Where it happened", pageOrFeature) : ""}
                            <div class="meta">
                                <p><strong>Submitted:</strong> ${escapeHtml(timestamp)}</p>${userAgent ? `\n                                <p><strong>Browser:</strong> ${escapeHtml(userAgent)}</p>` : ""}
                            </div>
                        </div>
                        <div class="footer">
                            <p>This is an automated message from the Bainum Project system.</p>
                        </div>
                    </div>
                </body>
                </html>
            `;

    const textLines = [
        "Bug Report",
        "",
        ORIGIN_BANNER,
        "",
        `Reported by: ${reporterLine}`,
        "",
        `Title: ${title}`,
        "",
        "Description:",
        description,
    ];
    if (stepsToReproduce) {
        textLines.push("", "Steps to reproduce:", stepsToReproduce);
    }
    if (pageOrFeature) {
        textLines.push("", `Where it happened: ${pageOrFeature}`);
    }
    textLines.push("", `Submitted: ${timestamp}`);
    if (userAgent) {
        textLines.push(`Browser: ${userAgent}`);
    }
    textLines.push("", "This is an automated message from the Bainum Project system.");

    return { subject, htmlContent, textContent: textLines.join("\n") };
}
