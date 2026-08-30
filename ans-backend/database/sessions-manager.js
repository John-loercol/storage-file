const crypto = require('crypto');
const permissions = require('./permissions-manager');

const SESSION_COOKIE = 'ans_session';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'true').toLowerCase() === 'true';
const COOKIE_SAME_SITE = COOKIE_SECURE ? 'none' : 'lax';
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 วัน

function parseCookies(req) {
    const header = req.headers.cookie || '';
    const cookies = {};

    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index === -1) continue;

        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();

        if (key) {
            try {
                cookies[key] = decodeURIComponent(value);
            } catch {
                cookies[key] = value;
            }
        }
    }

    return cookies;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function makeToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

function setSessionCookie(res, value, maxAge = SESSION_MAX_AGE) {
    res.cookie(SESSION_COOKIE, value, {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: COOKIE_SAME_SITE,
        path: '/',
        maxAge
    });
}

function clearSessionCookie(res) {
    res.cookie(SESSION_COOKIE, '', {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: COOKIE_SAME_SITE,
        path: '/',
        maxAge: 0
    });
}

async function createSession(userId) {
    const supabase = permissions.supabase;
    if (!supabase) {
        throw new Error('Database connection is not available');
    }

    const rawSessionToken = makeToken(32);
    const sessionHash = hashToken(rawSessionToken);

    const now = new Date();
    const expiresAt = new Date(
        now.getTime() + SESSION_MAX_AGE
    ).toISOString();

    const { data, error } = await supabase
        .from('sessions')
        .insert([{
            user_id: userId,
            session_token_hash: sessionHash,
            created_at: now.toISOString(),
            last_seen_at: now.toISOString(),
            expires_at: expiresAt
        }])
        .select('id, user_id, created_at, last_seen_at, expires_at')
        .single();

    if (error) throw error;

    return {
        token: rawSessionToken,
        session: data,
        expiresAt
    };
}

async function getSession(req) {
    const rawToken = parseCookies(req)[SESSION_COOKIE];
    if (!rawToken) return null;

    const supabase = permissions.supabase;
    if (!supabase) return null;

    const tokenHash = hashToken(rawToken);

    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('id, user_id, created_at, last_seen_at, expires_at')
        .eq('session_token_hash', tokenHash)
        .maybeSingle();

    if (sessionError || !session) return null;

    if (new Date(session.expires_at).getTime() <= Date.now()) {
        await supabase
            .from('sessions')
            .delete()
            .eq('id', session.id);

        return null;
    }

    const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, discord_id, username, role, is_dm_enabled')
        .eq('id', session.user_id)
        .maybeSingle();

    if (userError || !user) return null;

    // Sliding expiration:
    // ทุกครั้งที่ Session ถูกใช้งาน จะต่ออายุออกไปอีก 7 วัน
    const now = new Date();
    const nowIso = now.toISOString();
    const newExpiresAt = new Date(
        now.getTime() + SESSION_MAX_AGE
    ).toISOString();

    const { error: updateError } = await supabase
        .from('sessions')
        .update({
            last_seen_at: nowIso,
            expires_at: newExpiresAt
        })
        .eq('id', session.id);

    if (updateError) {
        console.error('Session refresh error:', updateError);
        return null;
    }

    return {
        session: {
            ...session,
            last_seen_at: nowIso,
            expires_at: newExpiresAt
        },
        user
    };
}

async function destroySession(req) {
    const rawToken = parseCookies(req)[SESSION_COOKIE];
    if (!rawToken) return;

    const supabase = permissions.supabase;
    if (!supabase) return;

    const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('session_token_hash', hashToken(rawToken));

    if (error) {
        throw error;
    }
}

module.exports = {
    SESSION_COOKIE,
    SESSION_MAX_AGE,
    COOKIE_SECURE,
    COOKIE_SAME_SITE,
    parseCookies,
    createSession,
    getSession,
    destroySession,
    setSessionCookie,
    clearSessionCookie
};
