import mongoose from "mongoose";

const centerSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true, 
        unique: true 
    },
    address: { 
        type: String 
    },
    phone: { 
        type: String 
    },
    email: { 
        type: String 
    },
    description: { 
        type: String 
    },
}, {
    timestamps: true
});

const Center = mongoose.model("Center", centerSchema);

export default Center;
