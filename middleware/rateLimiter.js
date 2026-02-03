import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import dotenv from "dotenv";

// Ensure environment variables are loaded
dotenv.config();

// Fallback in-memory rate limiter for development (when Redis is not configured)
const requestCounts = new Map();

const inMemoryRateLimiter = (req, res, next) => {
    try {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        const windowMs = 60 * 1000; // 1 minute
        const maxRequests = 100; // More lenient for development

        if (!requestCounts.has(ip)) {
            requestCounts.set(ip, { count: 1, resetTime: now + windowMs });
            return next();
        }

        const userRequests = requestCounts.get(ip);

        if (now > userRequests.resetTime) {
            // Reset window
            requestCounts.set(ip, { count: 1, resetTime: now + windowMs });
            return next();
        }

        if (userRequests.count >= maxRequests) {
            return res.status(429).json({ 
                message: "Too many requests. Please try again later.",
                retryAfter: Math.ceil((userRequests.resetTime - now) / 1000)
            });
        }

        userRequests.count++;
        next();
    } catch (error) {
        console.error("Rate limiter error:", error);
        next(); // Continue without rate limiting if there's an error
    }
};

// Initialize Redis-based rate limiter if credentials are available
let redisRateLimiter = null;

try {
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

    if (redisUrl && redisToken) {
        // Initialize Redis client
        const redis = new Redis({
            url: redisUrl,
            token: redisToken,
        });

        // Create rate limiter with sliding window
        // Allows 100 requests per minute per IP
        redisRateLimiter = new Ratelimit({
            redis: redis,
            limiter: Ratelimit.slidingWindow(100, "1 m"), // 100 requests per minute
            analytics: true,
            prefix: "@upstash/ratelimit",
        });

    }
} catch (error) {
    // Fallback to in-memory rate limiting on error
}

// Main rate limiter middleware
export default async function rateLimiter(req, res, next) {
    try {
        // Skip rate limiting for OPTIONS requests (CORS preflight)
        if (req.method === 'OPTIONS') {
            return next();
        }
        
        // Use Redis-based rate limiter if available, otherwise use in-memory
        if (redisRateLimiter) {
            const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
            
            const { success, limit, remaining, reset } = await redisRateLimiter.limit(ip);

            // Add rate limit headers
            res.setHeader('X-RateLimit-Limit', limit);
            res.setHeader('X-RateLimit-Remaining', remaining);
            res.setHeader('X-RateLimit-Reset', new Date(reset).toISOString());

            if (!success) {
                const retryAfter = Math.ceil((reset - Date.now()) / 1000);
                return res.status(429).json({
                    message: "Too many requests. Please try again later.",
                    retryAfter: retryAfter,
                    limit: limit,
                    reset: new Date(reset).toISOString()
                });
            }

            return next();
        } else {
            // Fallback to in-memory rate limiting
            return inMemoryRateLimiter(req, res, next);
        }
    } catch (error) {
        console.error("Rate limiter error:", error);
        // On error, allow the request to proceed (fail open)
        // This prevents Redis issues from blocking all requests
        return next();
    }
}
