export const parentChildAccess = async (req, res, next) => {
    const { user } = req.user;
    if (user.role === 'parent') {
        const child = await Child.findById(user.childId);
        if (!child) {
            return res.status(404).json({ message: 'Child not found' });
        }
    }
    next();
};