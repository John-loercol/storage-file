require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    MessageFlags,
    PermissionsBitField,
    EmbedBuilder
} = require('discord.js');
const permissions = require('./database/permissions-manager');
const sysBot = require('./commande/cmd-sys');
const notificationBot = require('./commande/notification-cmd');
const messageBot = require('./commande/message-cmd');

process.on('unhandledRejection', error => console.error('Unhandled Rejection:', error));
process.on('uncaughtException', error => console.error('Uncaught Exception:', error));

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const BACKEND_URL = (process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, '');
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `${BACKEND_URL}/auth/discord/callback`;
const SESSION_COOKIE = 'ans_session';
const OAUTH_STATE_COOKIE = 'ans_oauth_state';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'true').toLowerCase() === 'true';
const COOKIE_SAME_SITE = COOKIE_SECURE ? 'none' : 'lax';
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 วัน

// Netlify -> Render ต้องใช้ credentials และ origin แบบระบุเจาะจง
const allowedOrigins = new Set([
    FRONTEND_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000'
]);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true
}));
app.use(express.json());

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function parseCookies(req) {
    const header = req.headers.cookie || '';
    const cookies = {};
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index === -1) continue;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (key) cookies[key] = decodeURIComponent(value);
    }
    return cookies;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function makeToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

function setCrossSiteCookie(res, name, value, maxAge) {
    res.cookie(name, value, {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: COOKIE_SAME_SITE,
        path: '/',
        maxAge
    });
}

function clearCrossSiteCookie(res, name) {
    res.cookie(name, '', {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: COOKIE_SAME_SITE,
        path: '/',
        maxAge: 0
    });
}

async function getSession(req) {
    const rawToken = parseCookies(req)[SESSION_COOKIE];
    if (!rawToken) return null;

    const tokenHash = hashToken(rawToken);
    const supabase = permissions.supabase;

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

    await supabase
        .from('sessions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', session.id);

    return { session, user };
}

// ==========================================
// 1. API / Authentication สำหรับ Frontend
// ==========================================

app.get('/', (req, res) => {
    res.json({ status: 'online', service: 'ANS Backend API', credit: 'git industries inc.' });
});

app.get('/api/tasks', async (req, res) => {
    try {
        const supabase = permissions.supabase;
        if (!supabase) {
            return res.status(500).json({ error: 'Database connection is not available' });
        }

        const { data, error } = await supabase
            .from('tasks')
            .select('*')
            .order('due_date', { ascending: true });

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error('Error fetching tasks API:', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// เริ่ม Discord OAuth จาก Backend โดยตรง
app.get('/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId) return res.status(500).send('DISCORD_CLIENT_ID ยังไม่ได้ตั้งค่า');

    const state = makeToken(24);
    setCrossSiteCookie(res, OAUTH_STATE_COOKIE, state, 10 * 60 * 1000);

    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: DISCORD_REDIRECT_URI,
        scope: 'identify',
        state
    });

    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

// Discord OAuth2 Callback
app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    const cookies = parseCookies(req);

    if (!code) return res.status(400).send('ไม่พบรหัส Code จาก Discord');
    if (!state || !cookies[OAUTH_STATE_COOKIE] || state !== cookies[OAUTH_STATE_COOKIE]) {
        clearCrossSiteCookie(res, OAUTH_STATE_COOKIE);
        return res.status(400).send('OAuth state ไม่ถูกต้องหรือหมดอายุ กรุณาล็อกอินใหม่');
    }
    clearCrossSiteCookie(res, OAUTH_STATE_COOKIE);

    try {
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: DISCORD_REDIRECT_URI
            }),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const oauthData = await tokenResponse.json();
        if (oauthData.error || !oauthData.access_token) {
            console.error('Discord OAuth token error:', oauthData);
            return res.status(400).send(`เกิดข้อผิดพลาดจาก Discord: ${oauthData.error_description || oauthData.error}`);
        }

        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `${oauthData.token_type || 'Bearer'} ${oauthData.access_token}` }
        });
        const userData = await userResponse.json();

        if (!userResponse.ok || !userData.id) {
            console.error('Discord user error:', userData);
            return res.status(400).send('ไม่สามารถดึงข้อมูลบัญชี Discord ได้');
        }

        const supabase = permissions.supabase;
        if (!supabase) return res.status(500).send('Database connection is not available');

        // ให้ users เป็นตัวกลาง: session.user_id จะอ้างถึง users.id ไม่เก็บ Discord ID ตรง ๆ
        const username = userData.global_name || userData.username || `User_${userData.id}`;
        const { error: upsertError } = await supabase
            .from('users')
            .upsert([{
                discord_id: userData.id,
                username
            }], { onConflict: 'discord_id' });

        if (upsertError) throw upsertError;

        const { data: userRow, error: userError } = await supabase
            .from('users')
            .select('id, discord_id, username, role, is_dm_enabled')
            .eq('discord_id', userData.id)
            .single();

        if (userError || !userRow) throw userError || new Error('ไม่พบ users.id หลังจาก upsert');

        // เก็บเฉพาะ hash ลง DB ส่วน token จริงอยู่ใน HttpOnly cookie ของ Browser
        const rawSessionToken = makeToken(32);
        const sessionHash = hashToken(rawSessionToken);

        const expiresAt = new Date(
    Date.now() + SESSION_MAX_AGE
).toISOString();

const { error: sessionError } = await supabase
    .from('sessions')
    .insert([{
        user_id: userRow.id,
        session_token_hash: sessionHash,
        expires_at: expiresAt
        }]);

        if (sessionError) throw sessionError;

        setCrossSiteCookie(res, SESSION_COOKIE, rawSessionToken, SESSION_MAX_AGE);

        // ไม่ส่ง token ไปใน URL และไม่แสดงข้อมูลส่วนตัวในหน้า callback
        const separator = FRONTEND_URL.includes('?') ? '&' : '?';
        res.redirect(`${FRONTEND_URL}${separator}login=success`);
    } catch (error) {
        console.error('OAuth Error:', error);
        res.status(500).send('เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์');
    }
});

// Frontend เรียก endpoint นี้เพื่อถามว่า cookie เป็น session ของใคร
app.get('/api/me', async (req, res) => {
    try {
        const result = await getSession(req);
        if (!result) return res.status(401).json({ authenticated: false });

        res.json({
            authenticated: true,
            user: result.user,
            session: {
                created_at: result.session.created_at,
                last_seen_at: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Session check error:', error);
        res.status(500).json({ authenticated: false, error: 'Internal Server Error' });
    }
});

app.post('/auth/logout', async (req, res) => {
    try {
        const rawToken = parseCookies(req)[SESSION_COOKIE];
        if (rawToken) {
            await permissions.supabase
                .from('sessions')
                .delete()
                .eq('session_token_hash', hashToken(rawToken));
        }
        clearCrossSiteCookie(res, SESSION_COOKIE);
        res.json({ success: true });
    } catch (error) {
        console.error('Logout error:', error);
        clearCrossSiteCookie(res, SESSION_COOKIE);
        res.status(500).json({ success: false });
    }
});

app.listen(PORT, () => {
    console.log(`[ SERVER ] Backend API & Web Server is running on port ${PORT}`);
});

// ==========================================
// 2. Discord Bot & Automation System
// ==========================================

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const superAdminId = process.env.SUPER_ADMIN_ID;

async function ensureRolesExist(guild) {
    const roleNames = {
        'admin': 'SB-Admin',
        'mod': 'SB-Mod',
        'user': 'SB-User'
    };

    for (const [, name] of Object.entries(roleNames)) {
        let role = guild.roles.cache.find(r => r.name === name);
        if (!role) {
            try {
                await guild.roles.create({
                    name: name,
                    permissions: [PermissionsBitField.Flags.ChangeNickname],
                    reason: 'สร้างยศอัตโนมัติสำหรับซิงค์ข้อมูลกับ Supabase'
                });
                await sleep(500);
            } catch (err) {
                console.error(`[ × ] ไม่สามารถสร้างยศ ${name} ได้:`, err.message);
            }
        }
    }
}

async function registerAllCommands() {
    const commands = [
        ...messageBot.getCommands(),
        notificationBot.getCommand(),
        sysBot.getCommand()
    ];

    const rest = new REST({ version: '10' }).setToken(token);
    try {
        await rest.put(Routes.applicationCommands(clientId), { body: commands.map(c => c.toJSON()) });
        console.log('[ ✓ ] ลงทะเบียนคำสั่ง Slash Commands สำเร็จ!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

client.once('clientReady', async (c) => {
    console.log(`[ ONLINE ] บอทเชื่อมต่อแล้ว: ${c.user.tag}`);
    registerAllCommands();

    for (const [, guild] of c.guilds.cache) {
        await ensureRolesExist(guild);
    }
});

client.on('guildCreate', async guild => {
    await ensureRolesExist(guild);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const userId = interaction.user.id;
        const isSuperAdmin = userId === superAdminId;

        let userRole = await permissions.getUserRole(userId, superAdminId);
        if (isSuperAdmin && !userRole) userRole = 'admin';

        if (interaction.commandName === 'sys') {
            return await sysBot.handle(interaction, isSuperAdmin, userRole);
        }

        if (interaction.commandName === 'add') {
            return await notificationBot.handle(interaction, isSuperAdmin, userRole);
        }

        const allowed = isSuperAdmin || userRole !== null;
        if (!allowed) {
            return interaction.editReply({ content: "[ × ] คุณไม่มีสิทธิ์ใช้งานคำสั่งนี้! กรุณาติดต่อแอดมินเพื่อเพิ่มชื่อเข้าสู่ระบบ" });
        }

        if (typeof messageBot.handleWithEdit === 'function') {
            await messageBot.handleWithEdit(interaction);
        } else {
            await messageBot.handle(interaction);
        }

    } catch (error) {
        console.error('Interaction Error:', error);
        try {
            if (interaction.deferred) {
                await interaction.editReply({ content: "[ × ] เกิดข้อผิดพลาดในการประมวลผลคำสั่งหรือเชื่อมต่อฐานข้อมูล" });
            }
        } catch (e) {}
    }
});

client.login(token);
