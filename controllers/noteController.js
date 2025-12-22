import Note from "../models/Note.js";

export const createNote = async (req, res) => {
    try {
        const { childId, content, author, authorId } = req.body;

        // Validate required fields
        if (!childId || !content || !author) {
            return res.status(400).json({ message: "childId, content, and author are required" });
        }

        // Create new note
        const note = new Note({
            childId,
            content,
            author,
            authorId,
            timestamp: new Date()
        });

        await note.save();

        res.status(201).json({
            message: "Note created successfully",
            note
        });
    } catch (error) {
        console.error("Error creating note:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getNotesByChild = async (req, res) => {
    try {
        const { childId } = req.params;
        
        const notes = await Note.find({ childId }).sort({ timestamp: -1 });
        
        res.status(200).json({ notes });
    } catch (error) {
        console.error("Error fetching notes:", error);
        res.status(500).json({ message: error.message });
    }
};

export const deleteNote = async (req, res) => {
    try {
        const { noteId } = req.params;
        
        const deletedNote = await Note.findByIdAndDelete(noteId);
        
        if (!deletedNote) {
            return res.status(404).json({ message: "Note not found" });
        }
        
        res.status(200).json({ 
            message: "Note deleted successfully",
            note: deletedNote
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

        if (!content) {
            return res.status(400).json({ message: "Content is required" });
        }

        const updatedNote = await Note.findByIdAndUpdate(
            noteId,
            { content },
            { new: true }
        );

        if (!updatedNote) {
            return res.status(404).json({ message: "Note not found" });
        }

        res.status(200).json({
            message: "Note updated successfully",
            note: updatedNote
        });
    } catch (error) {
        console.error("Error updating note:", error);
        res.status(500).json({ message: error.message });
    }
};

