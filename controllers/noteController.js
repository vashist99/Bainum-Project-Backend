import Note from "../models/Note.js";
import {
    parseNoteScope,
    canReadChildNotes,
    canWriteChildNotes,
    canReadClassroomNotes,
    canWriteClassroomNotes,
    loadClassroomForNoteAccess,
    findParentsLinkedToChild,
} from "../lib/noteAccessHelpers.js";
import {
    fanOutChildNoteAddedNotifications,
    fanOutClassroomNoteAddedNotifications,
} from "../lib/notificationService.js";

function authorFromUser(user, bodyAuthor) {
    return bodyAuthor || user?.name || user?.email || "Unknown User";
}

async function notifyParentsForChildNote(user, childId) {
    if (user?.role !== "admin" && user?.role !== "teacher") return;
    try {
        const { child, parents } = await findParentsLinkedToChild(childId);
        if (!child || parents.length === 0) return;
        await fanOutChildNoteAddedNotifications({
            child,
            parentIds: parents.map((p) => p._id),
        });
    } catch (error) {
        console.error("[noteController] child note notification failed:", error.message);
    }
}

async function notifyParentsForClassroomNote(user, classroom) {
    if (user?.role !== "admin" && user?.role !== "teacher") return;
    try {
        const parentIds = (classroom.parents || []).map((p) => p._id ?? p);
        if (parentIds.length === 0) return;
        await fanOutClassroomNoteAddedNotifications({
            classroom,
            parentIds,
        });
    } catch (error) {
        console.error("[noteController] classroom note notification failed:", error.message);
    }
}

export const createNote = async (req, res) => {
    try {
        const { content, author, authorId } = req.body;
        const scope = parseNoteScope(req.body);
        if (!scope.ok) {
            return res.status(400).json({ message: scope.message });
        }
        if (!content || !String(content).trim()) {
            return res.status(400).json({ message: "content is required" });
        }

        const user = req.user;
        if (scope.childId) {
            if (!(await canWriteChildNotes(user, scope.childId))) {
                return res.status(403).json({ message: "You do not have access to add notes for this child" });
            }
        } else {
            const classroom = await loadClassroomForNoteAccess(scope.classroomId);
            if (!classroom) {
                return res.status(404).json({ message: "Classroom not found" });
            }
            if (!(await canWriteClassroomNotes(user, classroom))) {
                return res.status(403).json({ message: "You do not have access to add notes for this classroom" });
            }
        }

        const note = new Note({
            childId: scope.childId ?? undefined,
            classroomId: scope.classroomId ?? undefined,
            content: String(content).trim(),
            author: authorFromUser(user, author),
            authorId: authorId ?? user?.id,
            timestamp: new Date(),
        });

        await note.save();

        if (scope.childId) {
            await notifyParentsForChildNote(user, scope.childId);
        } else {
            const classroom = await loadClassroomForNoteAccess(scope.classroomId);
            if (classroom) await notifyParentsForClassroomNote(user, classroom);
        }

        res.status(201).json({
            message: "Note created successfully",
            note,
        });
    } catch (error) {
        console.error("Error creating note:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getNotesByChild = async (req, res) => {
    try {
        const { childId } = req.params;
        if (!(await canReadChildNotes(req.user, childId))) {
            return res.status(403).json({ message: "You do not have access to this child's notes" });
        }

        const notes = await Note.find({ childId }).sort({ timestamp: -1 });

        res.status(200).json({ notes });
    } catch (error) {
        console.error("Error fetching notes:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getNotesByClassroom = async (req, res) => {
    try {
        const { classroomId } = req.params;
        const classroom = await loadClassroomForNoteAccess(classroomId);
        if (!classroom) {
            return res.status(404).json({ message: "Classroom not found" });
        }
        if (!(await canReadClassroomNotes(req.user, classroom))) {
            return res.status(403).json({ message: "You do not have access to this classroom's notes" });
        }

        const notes = await Note.find({ classroomId }).sort({ timestamp: -1 });

        res.status(200).json({ notes });
    } catch (error) {
        console.error("Error fetching classroom notes:", error);
        res.status(500).json({ message: error.message });
    }
};

export const deleteNote = async (req, res) => {
    try {
        const { noteId } = req.params;

        const note = await Note.findById(noteId);
        if (!note) {
            return res.status(404).json({ message: "Note not found" });
        }

        if (note.childId) {
            if (!(await canWriteChildNotes(req.user, note.childId))) {
                return res.status(403).json({ message: "You do not have access to delete this note" });
            }
        } else if (note.classroomId) {
            const classroom = await loadClassroomForNoteAccess(note.classroomId);
            if (!classroom) {
                return res.status(404).json({ message: "Classroom not found" });
            }
            if (!(await canWriteClassroomNotes(req.user, classroom))) {
                return res.status(403).json({ message: "You do not have access to delete this note" });
            }
        } else {
            return res.status(400).json({ message: "Note has no scope" });
        }

        await Note.findByIdAndDelete(noteId);

        res.status(200).json({
            message: "Note deleted successfully",
            note,
        });
    } catch (error) {
        console.error("Error deleting note:", error);
        res.status(500).json({ message: error.message });
    }
};

export const updateNote = async (req, res) => {
    try {
        const { noteId } = req.params;
        const { content } = req.body;

        if (!content || !String(content).trim()) {
            return res.status(400).json({ message: "Content is required" });
        }

        const existing = await Note.findById(noteId);
        if (!existing) {
            return res.status(404).json({ message: "Note not found" });
        }

        if (existing.childId) {
            if (!(await canWriteChildNotes(req.user, existing.childId))) {
                return res.status(403).json({ message: "You do not have access to edit this note" });
            }
        } else if (existing.classroomId) {
            const classroom = await loadClassroomForNoteAccess(existing.classroomId);
            if (!classroom) {
                return res.status(404).json({ message: "Classroom not found" });
            }
            if (!(await canWriteClassroomNotes(req.user, classroom))) {
                return res.status(403).json({ message: "You do not have access to edit this note" });
            }
        }

        const updatedNote = await Note.findByIdAndUpdate(
            noteId,
            { content: String(content).trim() },
            { new: true }
        );

        res.status(200).json({
            message: "Note updated successfully",
            note: updatedNote,
        });
    } catch (error) {
        console.error("Error updating note:", error);
        res.status(500).json({ message: error.message });
    }
};
