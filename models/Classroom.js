import mongoose from "mongoose";
import { CLASSROOM_AGE_GROUPS, normalizeStoredAgeGroup } from "../lib/classroomHelpers.js";

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
    /** Optional age range in years. Unset classrooms stay valid. */
    ageGroup: {
        type: String,
        enum: [...CLASSROOM_AGE_GROUPS, null],
        default: null,
    },
    children: [{ type: mongoose.Schema.Types.ObjectId, ref: "Child" }],
    parents: [{ type: mongoose.Schema.Types.ObjectId, ref: "Parent" }],
}, {
    timestamps: true,
});

// Any save path (roster, invite, edit) must not fail on a former named band.
classroomSchema.pre("validate", function convertLegacyAgeGroup() {
    this.ageGroup = normalizeStoredAgeGroup(this.ageGroup);
});

const Classroom = mongoose.model("Classroom", classroomSchema);

export default Classroom;
