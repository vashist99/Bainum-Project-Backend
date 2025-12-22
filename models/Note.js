import mongoose from "mongoose";

const noteSchema = new mongoose.Schema({
    childId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "Child", 
        required: true 
    },
    content: { 
        type: String, 
        required: true 
    },
    author: { 
        type: String, 
        required: true 
    },
    authorId: { 
        type: String, 
        required: false 
    },
    timestamp: { 
        type: Date, 
        default: Date.now 
    }
}, {
    timestamps: true
});

const Note = mongoose.model("Note", noteSchema);

export default Note;

