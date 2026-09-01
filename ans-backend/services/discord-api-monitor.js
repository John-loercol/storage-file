'use strict';

const os = require('os');

function createDiscordApiMonitor() {
    const state = {
        requests: 0,
        blockedRequests: 0,
        rateLimitedEvents: 0,

        globalBlockedUntil: 0,

        lastRequestAt: null,
        lastRateLimitAt: null,

        lastRateLimit: null,

        buckets: new Map()
    };

    const now = () => Date.now();

    function normalizeRoute(route) {
        return route || 'unknown';
    }

    function cleanupBuckets() {
        const current = now();

        for (const [route, bucket] of state.buckets.entries()) {
            if (bucket.blockedUntil <= current) {
                state.buckets.delete(route);
            }
        }
    }

    function isGlobalBlocked() {
        return state.globalBlockedUntil > now();
    }

    function isRouteBlocked(route) {
        const bucket = state.buckets.get(
            normalizeRoute(route)
        );

        return Boolean(
            bucket &&
            bucket.blockedUntil > now()
        );
    }

    function getRemainingMs(route = null) {
        const current = now();

        let remaining = 0;

        if (state.globalBlockedUntil > current) {
            remaining = Math.max(
                remaining,
                state.globalBlockedUntil - current
            );
        }

        if (route) {
            const bucket = state.buckets.get(
                normalizeRoute(route)
            );

            if (
                bucket &&
                bucket.blockedUntil > current
            ) {
                remaining = Math.max(
                    remaining,
                    bucket.blockedUntil - current
                );
            }
        }

        return remaining;
    }

    function canRequest(route = null) {
        cleanupBuckets();

        if (isGlobalBlocked()) {
            return {
                allowed: false,
                reason: 'global_rate_limit',
                retryAfterMs: getRemainingMs()
            };
        }

        if (route && isRouteBlocked(route)) {
            return {
                allowed: false,
                reason: 'route_rate_limit',
                retryAfterMs: getRemainingMs(route)
            };
        }

        return {
            allowed: true,
            reason: null,
            retryAfterMs: 0
        };
    }

    function guard(route = null) {
        const result = canRequest(route);

        if (!result.allowed) {
            state.blockedRequests++;

            console.warn(
                '[ DISCORD API ] Request prevented by local rate-limit guard.'
            );

            console.warn(
                `[ DISCORD API ] Reason: ${result.reason}`
            );

            console.warn(
                `[ DISCORD API ] Remaining: ${result.retryAfterMs}ms`
            );
        }

        return result;
    }

    function recordRequest(route = null) {
        state.requests++;
        state.lastRequestAt =
            new Date().toISOString();

        console.log(
            `[ DISCORD API ] Request #${state.requests}` +
            `${route ? ` → ${route}` : ''}`
        );
    }

    function recordRateLimit(info = {}) {
        const retryAfterMs =
            Number(info.retryAfter || 0);

        const timeToResetMs =
            Number(info.timeToReset || 0);

        const durationMs =
            Math.max(
                retryAfterMs,
                timeToResetMs
            );

        const blockedUntil =
            now() + durationMs;

        const route =
            normalizeRoute(info.route);

        const global =
            Boolean(info.global);

        state.rateLimitedEvents++;

        state.lastRateLimitAt =
            new Date().toISOString();

        state.lastRateLimit = {
            global,

            route,

            method:
                info.method || null,

            majorParameter:
                info.majorParameter || null,

            limit:
                info.limit ?? null,

            retryAfterMs,

            timeToResetMs,

            scope:
                info.scope || null,

            sublimitTimeout:
                info.sublimitTimeout || 0,

            blockedUntil:
                new Date(
                    blockedUntil
                ).toISOString()
        };

        if (global) {
            state.globalBlockedUntil =
                Math.max(
                    state.globalBlockedUntil,
                    blockedUntil
                );
        }

        if (route !== 'unknown') {
            const previous =
                state.buckets.get(route);

            state.buckets.set(route, {
                route,

                blockedUntil:
                    Math.max(
                        previous?.blockedUntil || 0,
                        blockedUntil
                    ),

                limit:
                    info.limit ??
                    previous?.limit ??
                    null,

                scope:
                    info.scope ??
                    previous?.scope ??
                    null
            });
        }

        console.warn(
            '[ DISCORD API ] RATE LIMIT DETECTED'
        );

        console.warn(
            `[ DISCORD API ] Global: ${global}`
        );

        console.warn(
            `[ DISCORD API ] Route: ${route}`
        );

        console.warn(
            `[ DISCORD API ] Retry-After: ${retryAfterMs}ms`
        );

        console.warn(
            `[ DISCORD API ] Time-To-Reset: ${timeToResetMs}ms`
        );

        console.warn(
            `[ DISCORD API ] Blocked until: ${
                new Date(blockedUntil).toISOString()
            }`
        );
    }

    function attach(rest) {
        if (
            !rest ||
            typeof rest.on !== 'function'
        ) {
            throw new TypeError(
                'Discord REST instance is required.'
            );
        }

        rest.on(
            'rateLimited',
            info => {
                recordRateLimit(info);
            }
        );

        console.log(
            '[ DISCORD API ] Rate-limit monitor attached.'
        );

        return rest;
    }

    function getBucketStatus() {
        cleanupBuckets();

        const current = now();

        return Array.from(
            state.buckets.values()
        ).map(bucket => ({
            route: bucket.route,

            limit: bucket.limit,

            scope: bucket.scope,

            blocked:
                bucket.blockedUntil > current,

            remainingMs:
                Math.max(
                    0,
                    bucket.blockedUntil - current
                ),

            blockedUntil:
                bucket.blockedUntil > current
                    ? new Date(
                        bucket.blockedUntil
                    ).toISOString()
                    : null
        }));
    }

    function getStatus() {
        cleanupBuckets();

        return {
            requests:
                state.requests,

            blockedRequests:
                state.blockedRequests,

            rateLimitedEvents:
                state.rateLimitedEvents,

            global: {
                blocked:
                    isGlobalBlocked(),

                remainingMs:
                    Math.max(
                        0,
                        state.globalBlockedUntil - now()
                    ),

                blockedUntil:
                    isGlobalBlocked()
                        ? new Date(
                            state.globalBlockedUntil
                        ).toISOString()
                        : null
            },

            lastRequestAt:
                state.lastRequestAt,

            lastRateLimitAt:
                state.lastRateLimitAt,

            lastRateLimit:
                state.lastRateLimit,

            buckets:
                getBucketStatus()
        };
    }

    function getPackageVersion(packageName) {
        try {
            return require(
                `${packageName}/package.json`
            ).version;
        } catch {
            return 'unknown';
        }
    }

    function getSystemInfo() {
        return {
            node: {
                version:
                    process.version,

                platform:
                    process.platform,

                architecture:
                    process.arch,

                pid:
                    process.pid
            },

            os: {
                type:
                    os.type(),

                release:
                    os.release(),

                hostname:
                    os.hostname(),

                cpus:
                    os.cpus().length,

                memoryTotal:
                    os.totalmem(),

                memoryFree:
                    os.freemem()
            },

            packages: {
                discordjs:
                    getPackageVersion(
                        'discord.js'
                    ),

                express:
                    getPackageVersion(
                        'express'
                    ),

                cors:
                    getPackageVersion(
                        'cors'
                    ),

                dotenv:
                    getPackageVersion(
                        'dotenv'
                    ),

                supabase:
                    getPackageVersion(
                        '@supabase/supabase-js'
                    )
            },

            process: {
                uptime:
                    process.uptime()
            }
        };
    }

    return {
        attach,
        guard,
        canRequest,
        recordRequest,
        recordRateLimit,
        getRemainingMs,
        getStatus,
        getSystemInfo
    };
}

module.exports = {
    createDiscordApiMonitor
};