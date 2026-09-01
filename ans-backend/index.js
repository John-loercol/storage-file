require('dotenv').config();

const express = require('express');
const cors = require('cors');

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    MessageFlags
} = require('discord.js');

const permissions = require('./database/permissions-manager');

const {
    registerFrontendRoutes
} = require('./api/frontend-manager');

const {
    registerOAuthRoutes
} = require('./api/oauth-manager');

const {
    createDiscordApiMonitor
} = require('./services/discord-api-monitor');

const sysBot =
    require('./commande/cmd-sys');

const notificationBot =
    require('./commande/notification-cmd');

const messageBot =
    require('./commande/message-cmd');


/* ============================================================
   PROCESS ERROR HANDLING
   ============================================================ */

process.on(
    'unhandledRejection',
    error =>
        console.error(
            'Unhandled Rejection:',
            error
        )
);

process.on(
    'uncaughtException',
    error =>
        console.error(
            'Uncaught Exception:',
            error
        )
);


/* ============================================================
   EXPRESS SERVER
   ============================================================ */

const app = express();

const PORT =
    process.env.PORT || 3000;

const FRONTEND_URL = (
    process.env.FRONTEND_URL ||
    'http://localhost:3000'
).replace(/\/$/, '');

const allowedOrigins = new Set([
    FRONTEND_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000'
]);

app.use(
    cors({
        origin(origin, callback) {
            if (
                !origin ||
                allowedOrigins.has(origin)
            ) {
                return callback(
                    null,
                    true
                );
            }

            return callback(
                new Error(
                    `CORS blocked origin: ${origin}`
                )
            );
        },

        credentials: true
    })
);

app.use(
    express.json()
);


/* ============================================================
   API MODULES
   ============================================================ */

registerFrontendRoutes(app);
registerOAuthRoutes(app);


/* ============================================================
   BASIC HEALTH ENDPOINT
   ============================================================ */

app.get(
    '/',
    (req, res) => {
        res.json({
            status: 'online',
            service: 'ANS Backend API',
            credit: 'git industries inc.'
        });
    }
);


/* ============================================================
   DISCORD BOT
   ============================================================ */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const token =
    process.env.DISCORD_BOT_TOKEN;

const clientId =
    process.env.DISCORD_CLIENT_ID;

const superAdminId =
    process.env.SUPER_ADMIN_ID;


/* ============================================================
   DISCORD API MONITOR
   ============================================================ */

const discordApiMonitor =
    createDiscordApiMonitor();

const discordRest =
    client.rest;

discordRest.setToken(token);

discordApiMonitor.attach(
    discordRest
);


/* ============================================================
   SYSTEM REPORT
   ============================================================ */

const systemInfo =
    discordApiMonitor.getSystemInfo();

console.log(
    `[ SYSTEM ] Node.js: ${systemInfo.node.version}`
);

console.log(
    `[ SYSTEM ] Platform: ${systemInfo.node.platform}`
);

console.log(
    `[ SYSTEM ] Architecture: ${systemInfo.node.architecture}`
);

console.log(
    `[ SYSTEM ] discord.js: ${systemInfo.packages.discordjs}`
);

console.log(
    `[ SYSTEM ] Express: ${systemInfo.packages.express}`
);

console.log(
    `[ SYSTEM ] CORS: ${systemInfo.packages.cors}`
);

console.log(
    `[ SYSTEM ] dotenv: ${systemInfo.packages.dotenv}`
);

console.log(
    `[ SYSTEM ] Supabase: ${systemInfo.packages.supabase}`
);


/* ============================================================
   DISCORD SLASH COMMAND SYNCHRONIZATION
   ============================================================ */

async function registerAllCommands() {
    const commands = [
        ...messageBot.getCommands(),
        notificationBot.getCommand(),
        sysBot.getCommand()
    ];

    const route =
        'applicationCommands';

    /*
     * ตรวจสอบ local rate-limit state
     * ก่อนส่ง request
     */
    const guard =
        discordApiMonitor.guard(
            route
        );

    if (!guard.allowed) {
        console.warn(
            '[ DISCORD API ] Slash command synchronization skipped.'
        );

        return null;
    }

    try {
        console.log(
            `[ DISCORD API ] Preparing slash-command synchronization (${commands.length} commands)...`
        );

        discordApiMonitor.recordRequest(
            route
        );

        await discordRest.put(
            Routes.applicationCommands(
                clientId
            ),
            {
                body: commands.map(
                    command =>
                        command.toJSON()
                )
            }
        );

        console.log(
            '[ ✓ ] ลงทะเบียนคำสั่ง Slash Commands สำเร็จ!'
        );

    } catch (error) {

        /*
         * กรณี REST manager ส่ง 429
         * ให้ monitor บันทึกสถานะไว้
         */
        if (
            error?.status === 429
        ) {
            discordApiMonitor.recordRateLimit({
                global:
                    error?.rawError?.global ??
                    false,

                route,

                retryAfter:
                    Number(
                        error?.rawError?.retry_after ||
                        0
                    ),

                scope:
                    error?.rawError?.scope ??
                    null
            });

            console.error(
                '[ DISCORD API ] Slash command request received HTTP 429.'
            );

            return null;
        }

        console.error(
            '[ DISCORD API ] Slash command synchronization failed:',
            error
        );

        return null;
    }
}


/* ============================================================
   SYSTEM STATUS API
   ============================================================ */

app.get(
    '/api/system/status',
    (req, res) => {
        res.json({
            status: 'online',

            service:
                'ANS Backend API',

            timestamp:
                new Date().toISOString(),

            system:
                discordApiMonitor
                    .getSystemInfo(),

            discord:
                discordApiMonitor
                    .getStatus()
        });
    }
);


/* ============================================================
   SERVER START
   ============================================================ */

app.listen(
    PORT,
    () => {
        console.log(
            `[ SERVER ] Backend API & Web Server is running on port ${PORT}`
        );
    }
);


/* ============================================================
   DISCORD READY
   ============================================================ */

client.once(
    'clientReady',
    async c => {
        console.log(
            `[ ONLINE ] บอทเชื่อมต่อแล้ว: ${c.user.tag}`
        );

        await registerAllCommands();
    }
);


/* ============================================================
   GUILD CREATE
   ============================================================ */

client.on(
    'guildCreate',
    async guild => {
        /*
         * Intentionally empty.
         *
         * ไม่สร้าง Role อัตโนมัติอีกแล้ว
         * เพื่อไม่ให้เกิด Missing Permissions
         * และ Discord API requests ที่ไม่จำเป็น
         */
    }
);


/* ============================================================
   INTERACTION HANDLER
   ============================================================ */

client.on(
    'interactionCreate',
    async interaction => {
        if (
            !interaction.isChatInputCommand()
        ) {
            return;
        }

        try {
            await interaction.deferReply({
                flags: [
                    MessageFlags.Ephemeral
                ]
            });

            const userId =
                interaction.user.id;

            const isSuperAdmin =
                userId === superAdminId;

            let userRole =
                await permissions.getUserRole(
                    userId,
                    superAdminId
                );

            if (
                isSuperAdmin &&
                !userRole
            ) {
                userRole = 'admin';
            }

            if (
                interaction.commandName ===
                'sys'
            ) {
                return await sysBot.handle(
                    interaction,
                    isSuperAdmin,
                    userRole
                );
            }

            if (
                interaction.commandName ===
                'add'
            ) {
                return await notificationBot.handle(
                    interaction,
                    isSuperAdmin,
                    userRole
                );
            }

            const allowed =
                isSuperAdmin ||
                userRole !== null;

            if (!allowed) {
                return interaction.editReply({
                    content:
                        '[ × ] คุณไม่มีสิทธิ์ใช้งานคำสั่งนี้! กรุณาติดต่อแอดมินเพื่อเพิ่มชื่อเข้าสู่ระบบ'
                });
            }

            if (
                typeof messageBot.handleWithEdit ===
                'function'
            ) {
                await messageBot.handleWithEdit(
                    interaction
                );
            } else {
                await messageBot.handle(
                    interaction
                );
            }

        } catch (error) {
            console.error(
                'Interaction Error:',
                error
            );

            try {
                if (
                    interaction.deferred
                ) {
                    await interaction.editReply({
                        content:
                            '[ × ] เกิดข้อผิดพลาดในการประมวลผลคำสั่งหรือเชื่อมต่อฐานข้อมูล'
                    });
                }
            } catch (e) {}
        }
    }
);


/* ============================================================
   DISCORD LOGIN
   ============================================================ */

client.login(token);