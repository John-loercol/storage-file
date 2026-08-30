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
const { registerFrontendRoutes } = require('./api/frontend-manager');
const { registerOAuthRoutes } = require('./api/oauth-manager');

const sysBot = require('./commande/cmd-sys');
const notificationBot = require('./commande/notification-cmd');
const messageBot = require('./commande/message-cmd');

process.on('unhandledRejection', error =>
    console.error('Unhandled Rejection:', error)
);
process.on('uncaughtException', error =>
    console.error('Uncaught Exception:', error)
);

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = (
    process.env.FRONTEND_URL || 'http://localhost:3000'
).replace(/\/$/, '');

const allowedOrigins = new Set([
    FRONTEND_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000'
]);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
            return callback(null, true);
        }
        return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true
}));

app.use(express.json());

// API modules
registerFrontendRoutes(app);
registerOAuthRoutes(app);

// Backend health endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'ANS Backend API',
        credit: 'git industries inc.'
    });
});

app.listen(PORT, () => {
    console.log(
        `[ SERVER ] Backend API & Web Server is running on port ${PORT}`
    );
});

// Discord Bot & Automation System
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const superAdminId = process.env.SUPER_ADMIN_ID;

async function registerAllCommands() {
    const commands = [
        ...messageBot.getCommands(),
        notificationBot.getCommand(),
        sysBot.getCommand()
    ];

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands.map(c => c.toJSON()) }
        );
        console.log('[ ✓ ] ลงทะเบียนคำสั่ง Slash Commands สำเร็จ!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

client.once('clientReady', async c => {
    console.log(`[ ONLINE ] บอทเชื่อมต่อแล้ว: ${c.user.tag}`);
    registerAllCommands();
});

client.on('guildCreate', async guild => {
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
        await interaction.deferReply({
            flags: [MessageFlags.Ephemeral]
        });

        const userId = interaction.user.id;
        const isSuperAdmin = userId === superAdminId;

        let userRole = await permissions.getUserRole(
            userId,
            superAdminId
        );

        if (isSuperAdmin && !userRole) {
            userRole = 'admin';
        }

        if (interaction.commandName === 'sys') {
            return await sysBot.handle(
                interaction,
                isSuperAdmin,
                userRole
            );
        }

        if (interaction.commandName === 'add') {
            return await notificationBot.handle(
                interaction,
                isSuperAdmin,
                userRole
            );
        }

        const allowed = isSuperAdmin || userRole !== null;

        if (!allowed) {
            return interaction.editReply({
                content:
                    '[ × ] คุณไม่มีสิทธิ์ใช้งานคำสั่งนี้! กรุณาติดต่อแอดมินเพื่อเพิ่มชื่อเข้าสู่ระบบ'
            });
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
                await interaction.editReply({
                    content:
                        '[ × ] เกิดข้อผิดพลาดในการประมวลผลคำสั่งหรือเชื่อมต่อฐานข้อมูล'
                });
            }
        } catch (e) {}
    }
});

client.login(token);
