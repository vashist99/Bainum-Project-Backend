import mongoose from "mongoose";

// Username format: 3-30 chars, lowercase alphanumeric + underscore
const usernameRegex = /^[a-z0-9_]{3,30}$/;

const adminSchema = new mongoose.Schema({
    name: { type: String, required: true },
    username: { type: String, unique: true, sparse: true, lowercase: true, trim: true, match: [usernameRegex, 'Username must be 3-30 chars, lowercase letters, numbers, underscore'] },
    email: { type: String, required: true, unique: true },
    role: { type: String, required: true, enum: ["admin"] },
    password: { type: String, required: true },
});

const teacherSchema = new mongoose.Schema({
    name: { type: String, required: true },
    username: { type: String, unique: true, sparse: true, lowercase: true, trim: true, match: [usernameRegex, 'Username must be 3-30 chars, lowercase letters, numbers, underscore'] },
    email: { type: String, required: true, unique: true },
    role: { type: String, required: true, enum: ["teacher"] },
    password: { type: String, required: true },
    center: { type: String, required: true },
    education: { type: String, required: true },
    dateOfBirth: { type: Date, required: true },
});

const parentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    username: { type: String, unique: true, sparse: true, lowercase: true, trim: true, match: [usernameRegex, 'Username must be 3-30 chars, lowercase letters, numbers, underscore'] },
    email: { type: String, required: true, unique: true },
    role: { type: String, required: true, enum: ["parent"] },
    password: { type: String, required: true },
    /** Primary / legacy single-child field; kept in sync with childIds[0]. */
    childId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Child",
        required: false,
    },
    /** All children linked to this parent (invites + registration). */
    childIds: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Child",
        },
    ],
    invitationToken: { type: String }, // Store the invitation token used
    invitationAccepted: { type: Boolean, default: false },
}, {
    timestamps: true
});

const childSchema = new mongoose.Schema({
    name: { type: String, required: true },
    role: { type: String, required: true, enum: ["child"] },
    dateOfBirth: { type: Date, required: true },
    gender: { type: String, required: true },
    diagnosis: { type: String, required: true },
    primaryLanguage: { type: String, required: true },
    /**
     * Center the child belongs to (string, matching Teacher.center /
     * Classroom.center convention). Required at create time; new
     * children must be created with an explicit center. Replaces the
     * old `leadTeacher` free-form-name field whose center was derived
     * by name lookup.
     */
    center: { type: String, required: true, trim: true },
    /**
     * Classrooms this child is enrolled in. Populated when a parent
     * accepts a classroom invitation listing this child, or when an
     * admin manually enrolls the child via
     * PATCH /api/classrooms/:id/children. Pulled on classroom
     * deletion. Same-center rule is enforced at enroll time.
     */
    classrooms: [{ type: mongoose.Schema.Types.ObjectId, ref: "Classroom" }],
    parents: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "Parent" 
    }], // Link to parent accounts
    /** Parent email used for the Bainum invitation (or linked account), lowercase */
    invitedParentEmail: { type: String, trim: true, lowercase: true },
}, {
    timestamps: true
});


const Admin = mongoose.model("Admin", adminSchema);
const Teacher = mongoose.model("Teacher", teacherSchema);   
const Parent = mongoose.model("Parent", parentSchema);
const Child = mongoose.model("Child", childSchema);

export { Admin, Teacher, Parent, Child};