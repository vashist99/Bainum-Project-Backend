const MAX_COMMENT_LENGTH = 4000;

const CLEARED_NOTE = {
    text: "",
    authorName: "",
    authorId: null,
    updatedAt: null,
};

export function recorderIdOf(doc) {
    if (!doc) return "";
    return String(doc.recordedById?._id ?? doc.recordedById ?? "");
}

export function observationVisibleTo(user, doc) {
    if (!doc) return false;
    if (!doc.hidden) return true;
    const uid = String(user?.id ?? user?._id ?? "");
    const recorder = recorderIdOf(doc);
    return Boolean(uid && recorder && uid === recorder);
}

export function canHideObservation(user, doc) {
    const uid = String(user?.id ?? user?._id ?? "");
    const recorder = recorderIdOf(doc);
    return Boolean(uid && recorder && uid === recorder);
}

export function hiddenObservationMongoFilter(user) {
    const uid = user?.id ?? user?._id;
    return {
        $or: [{ hidden: { $ne: true } }, ...(uid ? [{ recordedById: uid }] : [])],
    };
}

export function andQuery(...parts) {
    const cleaned = parts.filter((part) => part && Object.keys(part).length > 0);
    if (cleaned.length === 0) return {};
    if (cleaned.length === 1) return cleaned[0];
    return { $and: cleaned };
}

export function filterVisibleObservations(user, docs) {
    return (docs || []).filter((doc) => observationVisibleTo(user, doc));
}

function commentTime(value) {
    const time = new Date(value || 0).getTime();
    return Number.isNaN(time) ? 0 : time;
}

function normalizeComment(comment) {
    return {
        text: String(comment?.text || "").trim(),
        authorName: comment?.authorName || "",
        authorId: comment?.authorId || null,
        createdAt: comment?.createdAt || null,
    };
}

export function validateObservationComment(text) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return { ok: false, message: "Comment cannot be empty" };
    if (trimmed.length > MAX_COMMENT_LENGTH) {
        return { ok: false, message: "Comment must be 4000 characters or fewer" };
    }
    return { ok: true, text: trimmed };
}

export function legacyObservationComment(note) {
    const text = String(note?.text || "").trim();
    if (!text) return null;
    return {
        text,
        authorName: note.authorName || "",
        authorId: note.authorId || null,
        createdAt: note.updatedAt || note.createdAt || null,
    };
}

export function resolvedObservationComments(doc) {
    const stored = (Array.isArray(doc?.observationComments) ? doc.observationComments : [])
        .map(normalizeComment)
        .filter((comment) => comment.text);
    if (stored.length > 0) {
        return stored.sort((a, b) => commentTime(a.createdAt) - commentTime(b.createdAt));
    }
    const legacy = legacyObservationComment(doc?.observationNote);
    return legacy ? [legacy] : [];
}

export function observationCommentUpdate(doc, user, text, now = new Date()) {
    const validated = validateObservationComment(text);
    if (!validated.ok) return { ok: false, message: validated.message };
    const comment = {
        text: validated.text,
        authorName: user?.name || user?.email || "Unknown",
        authorId: user?.id ?? user?._id ?? null,
        createdAt: now,
    };
    const stored = (Array.isArray(doc?.observationComments) ? doc.observationComments : [])
        .map(normalizeComment)
        .filter((entry) => entry.text);
    const legacy = stored.length === 0 ? legacyObservationComment(doc?.observationNote) : null;
    if (legacy) {
        return {
            ok: true,
            filter: {
                _id: doc._id,
                $or: [
                    { observationComments: { $exists: false } },
                    { observationComments: { $size: 0 } },
                ],
            },
            update: {
                $set: {
                    observationComments: [
                        { ...legacy, createdAt: legacy.createdAt || now },
                        comment,
                    ],
                    observationNote: CLEARED_NOTE,
                },
            },
            fallback: {
                $push: { observationComments: comment },
                $set: { observationNote: CLEARED_NOTE },
            },
        };
    }
    return {
        ok: true,
        filter: { _id: doc._id },
        update: {
            $push: { observationComments: comment },
            $set: { observationNote: CLEARED_NOTE },
        },
    };
}

export async function appendObservationComment(Model, doc, user, text) {
    const plan = observationCommentUpdate(doc, user, text);
    if (!plan.ok) return { error: plan.message, status: 400 };
    let updated = await Model.findOneAndUpdate(plan.filter, plan.update, {
        new: true,
        runValidators: true,
    });
    if (!updated && plan.fallback) {
        updated = await Model.findOneAndUpdate({ _id: doc._id }, plan.fallback, {
            new: true,
            runValidators: true,
        });
    }
    if (!updated) return { error: "Assessment not found", status: 404 };
    return { doc: updated };
}

export function serializeObservationMeta(user, doc) {
    return {
        observationComments: resolvedObservationComments(doc),
        hidden: !!doc?.hidden,
        recordedById: doc?.recordedById || null,
        canHide: canHideObservation(user, doc),
    };
}

export function withObservationFields(user, docs) {
    return (docs || []).map((doc) => {
        const plain = typeof doc?.toObject === "function" ? doc.toObject() : { ...doc };
        const { observationNote, ...rest } = plain;
        return { ...rest, ...serializeObservationMeta(user, plain) };
    });
}
