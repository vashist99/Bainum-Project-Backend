import mongoose from "mongoose";

const classroomSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    /** Lead teacher (exactly one per classroom; a teacher may lead many classrooms). */
    teacher: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Teacher",
        required: true,
        index: true,
    },
    /** Optional single assistant teacher — same center as the classroom, never the lead. */
    assistantTeacher: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Teacher",
        default: null,
    },
    /** Center NAME string, matching the Teacher.center convention. */
    center: { type: String, required: true, trim: true },
    children: [{ type: mongoose.Schema.Types.ObjectId, ref: "Child" }],
    parents: [{ type: mongoose.Schema.Types.ObjectId, ref: "Parent" }],
}, {
    timestamps: true,
});

const Classroom = mongoose.model("Classroom", classroomSchema);

export default Classroom;
