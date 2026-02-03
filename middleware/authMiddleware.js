// authMiddleware.js
import jwt from "jsonwebtoken";

function authenticateToken(req, res, next) {
    // Get token from the Authorization header (format: "Bearer TOKEN")
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Get the second part

    if (token == null) {
        return res.sendStatus(401); // If no token, return Unauthorized
    }

    // Verify the token
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT verification error:', err.message);
            return res.sendStatus(403); // If token is invalid or expired, return Forbidden
        }
        
        req.user = user; // Attach user payload to the request object
        next(); // Proceed to the next middleware/route handler
    });
}

export default authenticateToken;
