import mongoose from "mongoose";

const noteSchema = new mongoose.Schema({
    childId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Child",
        required: false,
    },
    classroomId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Classroom",
        required: false,
    },
    content: {
        type: String,
        required: true,
    },
    author: {
        type: String,
        required: true,
    },
    authorId: {
        type: String,
        required: false,
    },
    timestamp: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: true,
});

noteSchema.pre("validate", function validateScope(next) {
    const hasChild = this.childId != null;
    const hasClassroom = this.classroomId != null;
    if (hasChild && hasClassroom) {
        return next(new Error("Provide childId or classroomId, not both"));
    }
    if (!hasChild && !hasClassroom) {
        return next(new Error("childId or classroomId is required"));
    }
    next();
});

const Note = mongoose.model("Note", noteSchema);

export default Note;
