const MAX_NOTE_LENGTH = 4000;

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

export function applyObservationNote(doc, user, text) {
    const trimmed = String(text ?? "").trim().slice(0, MAX_NOTE_LENGTH);
    if (!trimmed) {
        doc.observationNote = {
            text: "",
            authorName: "",
            authorId: null,
            updatedAt: null,
        };
        return doc;
    }
    doc.observationNote = {
        text: trimmed,
        authorName: user?.name || user?.email || "Unknown",
        authorId: user?.id ?? user?._id ?? null,
        updatedAt: new Date(),
    };
    return doc;
}

export function serializeObservationMeta(user, doc) {
    const note = doc?.observationNote;
    const hasNote = Boolean(note && String(note.text || "").trim());
    return {
        observationNote: hasNote
            ? {
                  text: note.text,
                  authorName: note.authorName || "",
                  authorId: note.authorId || null,
                  updatedAt: note.updatedAt || null,
              }
            : null,
        hidden: !!doc?.hidden,
        recordedById: doc?.recordedById || null,
        canHide: canHideObservation(user, doc),
    };
}

export function withObservationFields(user, docs) {
    return (docs || []).map((doc) => {
        const plain = typeof doc?.toObject === "function" ? doc.toObject() : { ...doc };
        return { ...plain, ...serializeObservationMeta(user, plain) };
    });
}
