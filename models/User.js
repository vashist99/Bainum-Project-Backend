import mongoose from "mongoose";

const adminSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: { type: String, required: true, enum: ["admin"] },
    password: { type: String, required: true },
});

const teacherSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: { type: String, required: true, enum: ["teacher"] },
    password: { type: String, required: true },
    center: { type: String, required: true },
    education: { type: String, required: true },
    dateOfBirth: { type: Date, required: true },
});

const parentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: { type: String, required: true, enum: ["parent"] },
    password: { type: String, required: true },
    childId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "Child", 
        required: true 
    },
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
    leadTeacher: { type: String, required: true, ref: "Teacher" },
    parents: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "Parent" 
    }], // Link to parent accounts
}, {
    timestamps: true
});


const Admin = mongoose.model("Admin", adminSchema);
const Teacher = mongoose.model("Teacher", teacherSchema);   
const Parent = mongoose.model("Parent", parentSchema);
const Child = mongoose.model("Child", childSchema);

export { Admin, Teacher, Parent, Child};