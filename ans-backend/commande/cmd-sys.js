const { SlashCommandBuilder } = require('discord.js');
const permissions = require('../database/permissions-manager');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const managedRoles = {
    'admin': 'SB-Admin',
    'mod': 'SB-Mod',
    'user': 'SB-User'
};

const statusRoles = {
    'verifier': 'Verifier'
};

async function syncUserDiscordRole(member, supabaseRole) {
    const targetRoleName = managedRoles[supabaseRole];

    try {
        const guild = member.guild;

        for (const [key, rName] of Object.entries(managedRoles)) {
            const roleObj = guild.roles.cache.find(r => r.name === rName);
            if (roleObj) {
                if (key === supabaseRole) {
                    if (!member.roles.cache.has(roleObj.id)) {
                        await member.roles.add(roleObj);
                        await sleep(300);
                    }
                } else {
                    if (member.roles.cache.has(roleObj.id)) {
                        await member.roles.remove(roleObj);
                        await sleep(300);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Error syncing Discord role:', err.message);
    }
}

async function toggleVerifierRole(member, action) {
    const roleName = statusRoles['verifier'];
    try {
        const guild = member.guild;
        const roleObj = guild.roles.cache.find(r => r.name === roleName);
        if (!roleObj) return false;

        if (action === 'add' && !member.roles.cache.has(roleObj.id)) {
            await member.roles.add(roleObj);
            await sleep(300);
        } else if (action === 'remove' && member.roles.cache.has(roleObj.id)) {
            await member.roles.remove(roleObj);
            await sleep(300);
        }
        return true;
    } catch (err) {
        console.error('Error toggling verifier role:', err.message);
        return false;
    }
}

async function removeAllManagedRoles(member) {
    try {
        const guild = member.guild;
        const allRolesToClean = { ...managedRoles, ...statusRoles };
        for (const [, rName] of Object.entries(allRolesToClean)) {
            const roleObj = guild.roles.cache.find(r => r.name === rName);
            if (roleObj && member.roles.cache.has(roleObj.id)) {
                await member.roles.remove(roleObj);
                await sleep(300);
            }
        }
    } catch (err) {
        console.error('Error removing managed roles:', err.message);
    }
}

function getCommand() {
    return new SlashCommandBuilder()
        .setName('sys')
        .setDescription('• ระบบจัดการบอทและฐานข้อมูล')
        .addSubcommand(sub =>
            sub.setName('shutdown')
               .setDescription('• ปิดการทำงานของระบบบอท')
        )
        .addSubcommand(sub =>
            sub.setName('addpermission')
               .setDescription('• เพิ่มหรืออัปเดตสิทธิ์ผู้ใช้งานระบบ (1 คน 1 บทบาท)')
               .addUserOption(o => o.setName('user').setRequired(true).setDescription('• เป้าหมายที่ต้องการกำหนดสิทธิ์'))
               .addStringOption(o => 
                   o.setName('rolename')
                    .setRequired(true)
                    .setDescription('• ระดับยศที่ต้องการกำหนด')
                    .addChoices(
                        { name: 'SB-Admin', value: 'admin' },
                        { name: 'SB-Mod', value: 'mod' },
                        { name: 'SB-User', value: 'user' }
                    )
               )
        )
        .addSubcommand(sub =>
            sub.setName('verifier')
               .setDescription('• จัดการสถานะยืนยันตัวตน (Verifier) สำหรับหน้าเว็บไซต์')
               .addUserOption(o => o.setName('user').setRequired(true).setDescription('• เป้าหมาย'))
               .addStringOption(o =>
                   o.setName('action')
                    .setRequired(true)
                    .setDescription('• เลือกการกระทำ')
                    .addChoices(
                        { name: 'Give Verifier', value: 'add' },
                        { name: 'Remove Verifier', value: 'remove' }
                    )
               )
        )
        .addSubcommand(sub =>
            sub.setName('deletepermission')
               .setDescription('• ลบสิทธิ์ผู้ใช้งานออกจากระบบ')
               .addUserOption(o => o.setName('user').setRequired(true).setDescription('• เป้าหมายที่ต้องการลบสิทธิ์'))
        )
        .addSubcommand(sub =>
            sub.setName('databaselist')
               .setDescription('• ตรวจสอบฐานข้อมูลรายชื่อผู้ใช้ตามระดับยศ')
               .addStringOption(o => 
                   o.setName('rolename')
                    .setRequired(true)
                    .setDescription('• เลือกดูตามระดับยศ')
                    .addChoices(
                        { name: 'SB-Admin', value: 'admin' },
                        { name: 'SB-Mod', value: 'mod' },
                        { name: 'SB-User', value: 'user' }
                    )
               )
        )
        .setDefaultMemberPermissions(0);
}

async function handle(interaction, isSuperAdmin, userRole) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'shutdown') {
        if (!isSuperAdmin && userRole !== 'admin') {
            return interaction.editReply({ content: "[ × ] ไม่อนุญาต! คำสั่งนี้สำหรับผู้มีสิทธิ์ระดับ SB-Admin เท่านั้น" });
        }
        await interaction.editReply({ content: "service หยุดทำงานแล้ว" });
        return process.exit();
    }

    if (subcommand === 'addpermission') {
        if (!isSuperAdmin && userRole !== 'admin') {
            return interaction.editReply({ content: "[ × ] ไม่อนุญาต! คำสั่งนี้สำหรับผู้มีสิทธิ์ระดับ SB-Admin เท่านั้น" });
        }

        const target = interaction.options.getMember('user');
        const roleChoice = interaction.options.getString('rolename');
        if (!target) return interaction.editReply({ content: "[ × ] ไม่พบผู้ใช้รายนี้ในเซิร์ฟเวอร์!" });

        // [ ป้องกัน ] เช็กว่าเป็น Bot / Application หรือไม่
        if (target.user.bot) {
            return interaction.editReply({ content: "[ × ] ไม่สามารถกำหนดสิทธิ์ระบบให้กับ Bot หรือ Application ได้!" });
        }

        await permissions.addUser(target.id, target.user.username, roleChoice);
        await sleep(200);
        
        await syncUserDiscordRole(target, roleChoice);

        return interaction.editReply({ content: `[ ✓ ] add ${target.user.username} เป็น ${roleChoice.toUpperCase()} เรียบร้อย` });
    }

    if (subcommand === 'verifier') {
        if (!isSuperAdmin && userRole !== 'admin' && userRole !== 'mod') {
            return interaction.editReply({ content: "[ × ] ไม่อนุญาต! สำหรับผู้มีสิทธิ์ระดับ SB-Admin หรือ SB-Mod เท่านั้น" });
        }

        const target = interaction.options.getMember('user');
        const action = interaction.options.getString('action');
        if (!target) return interaction.editReply({ content: "[ × ] ไม่พบผู้ใช้รายนี้ในเซิร์ฟเวอร์!" });

        const success = await toggleVerifierRole(target, action);
        if (!success) return interaction.editReply({ content: "[ × ] เกิดข้อผิดพลาดในการจัดการยศ Verifier (ไม่พบยศใน Discord)" });

        const actionText = action === 'add' ? 'เพิ่มยศ Verifier ให้' : 'ถอดถอนยศ Verifier จาก';
        return interaction.editReply({ content: `[ ✓ ] ${actionText} ${target.user.username} เรียบร้อยแล้ว (Session เว็บไซต์ยังคงปลอดภัย)` });
    }

    if (subcommand === 'deletepermission') {
        if (!isSuperAdmin && userRole !== 'admin') {
            return interaction.editReply({ content: "[ × ] ไม่อนุญาต! คำสั่งนี้สำหรับผู้มีสิทธิ์ระดับ SB-Admin เท่านั้น" });
        }

        const targetUser = interaction.options.getUser('user');
        if (!targetUser) return interaction.editReply({ content: "[ × ] ไม่พบข้อมูลผู้ใช้" });

        await permissions.removeUser(targetUser.id);
        await sleep(200);

        const memberTarget = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (memberTarget) {
            await removeAllManagedRoles(memberTarget);
        }

        return interaction.editReply({ content: `[ ✓ ] ลบสิทธิ์และข้อมูลของ ID: ${targetUser.id} ออกเรียบร้อย` });
    }

    if (subcommand === 'databaselist') {
        if (!isSuperAdmin && userRole !== 'admin' && userRole !== 'mod') {
            return interaction.editReply({ content: "[ × ] ไม่อนุญาต! สำหรับผู้มีสิทธิ์ระดับ SB-Admin หรือ SB-Mod เท่านั้น" });
        }

        const roleChoice = interaction.options.getString('rolename');
        const list = await permissions.getAllUsers();
        // กรองเอาเฉพาะ User ที่ไม่ใช่ Bot ออกจากรายการแสดงผลด้วย
        const filteredList = list.filter(u => u.role === roleChoice);

        if (filteredList.length === 0) {
            return interaction.editReply({ content: `[ × ] ไม่พบผู้ใช้งานใน Role: ${roleChoice.toUpperCase()}` });
        }

        const resultLines = [];
        for (let i = 0; i < filteredList.length; i++) {
            const u = filteredList[i];
            const member = await interaction.guild.members.fetch(u.id).catch(() => null);
            
            if (member) {
                // ข้ามบัญชีที่เป็นบอต ไม่เอามาแสดงในลิสต์
                if (member.user.bot) continue;

                await syncUserDiscordRole(member, u.role);
                
                const serverDisplayName = member.displayName; 
                const realUsername = u.username;

                resultLines.push(
                    `${resultLines.length + 1}. Display Name: ${serverDisplayName}\n- Username: ${realUsername}\n- discord_id: ${u.id}\n- Role: [ ${u.role.toUpperCase()} ]\n- by: system`
                );
            }
        }

        if (resultLines.length === 0) {
            return interaction.editReply({ content: `[ × ] ไม่พบข้อมูลสมาชิก (ที่เป็นมนุษย์) ภายในเซิร์ฟเวอร์สำหรับยศนี้` });
        }

        const responseMessage = `## > Database list of user\n` +
                                `### - ได้รับการยืนยันข้อมูลจาก supabase.com และ Discord\n` +
                                `-# รายการชื่อผู้ใช้ทั้งหมดเฉพาะ Role: ${roleChoice.toUpperCase()}\n` +
                                `\`\`\`text\n${resultLines.join('\n\n')}\n\`\`\``;

        return interaction.editReply({ content: responseMessage });
    }
}

module.exports = { getCommand, handle };
