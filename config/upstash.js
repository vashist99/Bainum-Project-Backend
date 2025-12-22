import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "60s"),
    prefix: "rate-limit",
});

export default limiter;