const crypto = require('crypto');
const permissions = require('../database/permissions-manager');
const sessions = require('../database/sessions-manager');

const FRONTEND_URL = (
    process.env.FRONTEND_URL || 'http://localhost:3000'
).replace(/\/$/, '');

const BACKEND_URL = (
    process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'
).replace(/\/$/, '');

const DISCORD_REDIRECT_URI =
    process.env.DISCORD_REDIRECT_URI ||
    `${BACKEND_URL}/auth/discord/callback`;

const OAUTH_STATE_COOKIE = 'ans_oauth_state';

const COOKIE_SECURE =
    String(process.env.COOKIE_SECURE || 'true').toLowerCase() === 'true';

const COOKIE_SAME_SITE = COOKIE_SECURE ? 'none' : 'lax';

function makeToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

function setOAuthStateCookie(res, value, maxAge) {
    res.cookie(OAUTH_STATE_COOKIE, value, {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: COOKIE_SAME_SITE,
        path: '/',
        maxAge
    });
}

function clearOAuthStateCookie(res) {
    res.cookie(OAUTH_STATE_COOKIE, '', {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: COOKIE_SAME_SITE,
        path: '/',
        maxAge: 0
    });
}

function registerOAuthRoutes(app) {
    app.get('/auth/discord', (req, res) => {
        const clientId = process.env.DISCORD_CLIENT_ID;
        if (!clientId) {
            return res.status(500).send('DISCORD_CLIENT_ID ยังไม่ได้ตั้งค่า');
        }

        const state = makeToken(24);
        setOAuthStateCookie(res, state, 10 * 60 * 1000);

        const params = new URLSearchParams({
            client_id: clientId,
            response_type: 'code',
            redirect_uri: DISCORD_REDIRECT_URI,
            scope: 'identify',
            state
        });

        res.redirect(
            `https://discord.com/oauth2/authorize?${params.toString()}`
        );
    });

    app.get('/auth/discord/callback', async (req, res) => {
        const code = req.query.code;
        const state = req.query.state;
        const cookies = sessions.parseCookies(req);

        if (!code) {
            return res.status(400).send('ไม่พบรหัส Code จาก Discord');
        }

        if (
            !state ||
            !cookies[OAUTH_STATE_COOKIE] ||
            state !== cookies[OAUTH_STATE_COOKIE]
        ) {
            clearOAuthStateCookie(res);
            return res.status(400).send(
                'OAuth state ไม่ถูกต้องหรือหมดอายุ กรุณาล็อกอินใหม่'
            );
        }

        clearOAuthStateCookie(res);

        try {
            const tokenResponse = await fetch(
                'https://discord.com/api/oauth2/token',
                {
                    method: 'POST',
                    body: new URLSearchParams({
                        client_id: process.env.DISCORD_CLIENT_ID,
                        client_secret: process.env.DISCORD_CLIENT_SECRET,
                        grant_type: 'authorization_code',
                        code,
                        redirect_uri: DISCORD_REDIRECT_URI
                    }),
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            const oauthData = await tokenResponse.json();

if (!tokenResponse.ok || !oauthData.access_token) {
    console.error('Discord OAuth token error:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        response: oauthData
    });

    const errorMessage =
        oauthData.error_description ||
        oauthData.error ||
        oauthData.message ||
        `Discord ไม่ได้ส่ง access_token กลับมา (HTTP ${tokenResponse.status})`;

    return res.status(400).send(
        `เกิดข้อผิดพลาดจาก Discord: ${errorMessage}`
    );
}

            const userResponse = await fetch(
                'https://discord.com/api/users/@me',
                {
                    headers: {
                        authorization: `${
                            oauthData.token_type || 'Bearer'
                        } ${oauthData.access_token}`
                    }
                }
            );

            const userData = await userResponse.json();

            if (!userResponse.ok || !userData.id) {
                console.error('Discord user error:', userData);
                return res.status(400).send(
                    'ไม่สามารถดึงข้อมูลบัญชี Discord ได้'
                );
            }

            const supabase = permissions.supabase;
            if (!supabase) {
                return res.status(500).send(
                    'Database connection is not available'
                );
            }

            const username =
                userData.global_name ||
                userData.username ||
                `User_${userData.id}`;

            const { error: upsertError } = await supabase
                .from('users')
                .upsert(
                    [{ discord_id: userData.id, username }],
                    { onConflict: 'discord_id' }
                );

            if (upsertError) throw upsertError;

            const { data: userRow, error: userError } = await supabase
                .from('users')
                .select('id, discord_id, username, role, is_dm_enabled')
                .eq('discord_id', userData.id)
                .single();

            if (userError || !userRow) {
                throw (
                    userError ||
                    new Error('ไม่พบ users.id หลังจาก upsert')
                );
            }

            const createdSession = await sessions.createSession(userRow.id);
            sessions.setSessionCookie(res, createdSession.token);

            const separator = FRONTEND_URL.includes('?') ? '&' : '?';
            res.redirect(`${FRONTEND_URL}${separator}login=success`);
        } catch (error) {
            console.error('OAuth Error:', error);
            res.status(500).send('เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์');
        }
    });
}

module.exports = { registerOAuthRoutes };
