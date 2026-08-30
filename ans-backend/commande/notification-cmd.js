const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const permissions = require('../database/permissions-manager');

/**
 * ฟังก์ชันแปลงวันเวลา รองรับทั้ง พ.ศ. และ ค.ศ.
 * รูปแบบที่รองรับ:
 * - วัน/เดือน/ปี พ.ศ. (เช่น 23/08/2569 หรือ 23/8/2569)
 * - วัน/เดือน/ปี ค.ศ. (เช่น 23/08/2026 หรือ 23/8/2026)
 * - ระบุเวลาพ่วงท้ายได้ (เช่น 23/08/2569 14:30 หรือ 23/08/2026 14:30)
 */
function parseThaiDate(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;

    const parts = timeStr.trim().split(/\s+/);
    const datePart = parts[0];
    const timePart = parts[1] || '09:00'; // ค่าเริ่มต้นเวลา 09:00 น. หากไม่ระบุ

    const dateMatch = datePart.split(/[/.-]/);
    if (dateMatch.length !== 3) return null;

    let day = parseInt(dateMatch[0], 10);
    let month = parseInt(dateMatch[1], 10) - 1; // เดือนใน JavaScript เริ่มจาก 0 (0-11)
    let year = parseInt(dateMatch[2], 10);

    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

    // ระบบตรวจสอบและแปลงศักราชอัตโนมัติ:
    // หากปีมากกว่า 2500 จะถูกมองว่าเป็น พุทธศักราช (พ.ศ.) และแปลงเป็น คริสตศักราช (-543) ทันที
    if (year > 2500) {
        year -= 543;
    }

    const timeMatch = timePart.split(':');
    let hour = parseInt(timeMatch[0] || '0', 10);
    let minute = parseInt(timeMatch[1] || '0', 10);

    if (isNaN(hour) || isNaN(minute)) return null;

    const targetDate = new Date(year, month, day, hour, minute, 0);
    return isNaN(targetDate.getTime()) ? null : targetDate;
}

function getCommand() {
    return new SlashCommandBuilder()
        .setName('add')
        .setDescription('• ระบบจัดการบันทึกและแจ้งเตือน')
        .addSubcommand(sub =>
            sub.setName('notification')
               .setDescription('• เพิ่มการแจ้งเตือนส่วนตัว (DM) ตามเวลาที่กำหนด')
               .addStringOption(o => 
                   o.setName('title')
                    .setDescription('• หัวข้อการแจ้งเตือน (%aa%)')
                    .setRequired(true)
               )
               .addStringOption(o => 
                   o.setName('subtitle')
                    .setDescription('• รายละเอียดคร่าวๆ (%dd%)')
                    .setRequired(true)
               )
               .addStringOption(o => 
                   o.setName('text')
                    .setDescription('• ข้อความรายละเอียดทั้งหมด (%cc%)')
                    .setRequired(true)
               )
               .addStringOption(o => 
                   o.setName('color')
                    .setDescription('• เลือกสีของ Embed')
                    .setRequired(true)
                    .addChoices(
                        { name: 'แดง / Red (#ff0000)', value: '#ff0000' },
                        { name: 'แดงเข้ม / Dark Red (#8b0000)', value: '#8b0000' },
                        { name: 'ส้ม / Orange (#ffa500)', value: '#ffa500' },
                        { name: 'ส้มอิฐ / Brick Orange (#d2691e)', value: '#d2691e' },
                        { name: 'เหลือง / Yellow (#ffff00)', value: '#ffff00' },
                        { name: 'เขียว / Green (#008000)', value: '#008000' },
                        { name: 'เขียวมะนาว / Lime (#32cd32)', value: '#32cd32' },
                        { name: 'ฟ้า / Sky Blue (#00bfff)', value: '#00bfff' },
                        { name: 'น้ำเงิน / Blue (#0000ff)', value: '#0000ff' },
                        { name: 'น้ำเงินเข้ม / Navy (#000080)', value: '#000080' },
                        { name: 'ม่วง / Purple (#800080)', value: '#800080' },
                        { name: 'คราม / Indigo (#4b0082)', value: '#4b0082' },
                        { name: 'ชมพู / Pink (#ff1493)', value: '#ff1493' },
                        { name: 'ทอง / Gold (#ffd700)', value: '#ffd700' },
                        { name: 'น้ำตาล / Brown (#8b4513)', value: '#8b4513' },
                        { name: 'ดำ / Black (#000000)', value: '#000000' },
                        { name: 'เทา / Gray (#808080)', value: '#808080' },
                        { name: 'ขาว / White (#ffffff)', value: '#ffffff' }
                    )
               )
               .addStringOption(o => 
                   o.setName('time')
                    .setDescription('• วัน/เดือน/ปี เช่น 25/12/2569 หรือ 25/12/2569 14:30 (รองรับ พ.ศ. และ ค.ศ.)')
                    .setRequired(true)
               )
        );
}

async function handle(interaction, isSuperAdmin, userRole) {
    const allowedRoles = ['user', 'mod', 'admin'];
    if (!isSuperAdmin && !allowedRoles.includes(userRole)) {
        return interaction.editReply({ 
            content: '[ × ] ไม่อนุญาต! คำสั่งนี้สำหรับผู้มีสิทธิ์ระดับ SB-User ขึ้นไปเท่านั้น' 
        });
    }

    const title = interaction.options.getString('title');
    const subtitle = interaction.options.getString('subtitle');
    const text = interaction.options.getString('text');
    const color = interaction.options.getString('color');
    const timeInput = interaction.options.getString('time');

    const targetDate = parseThaiDate(timeInput);
    if (!targetDate) {
        return interaction.editReply({ 
            content: '[ × ] รูปแบบวันที่/เวลาไม่ถูกต้อง!\n**รูปแบบที่ถูกต้อง:** `วัน/เดือน/ปี` หรือ `วัน/เดือน/ปี ชั่วโมง:นาที`\n**ตัวอย่าง:** `25/12/2569` หรือ `25/12/2569 14:30` (รองรับทั้ง พ.ศ. และ ค.ศ.)' 
        });
    }

    const now = new Date();

    if (targetDate < now) {
        return interaction.editReply({ 
            content: '[ × ] ไม่สามารถตั้งเวลาแจ้งเตือนย้อนกลับไปในอดีตได้!' 
        });
    }

    const maxFuture = new Date(now.getTime() + (100 * 24 * 60 * 60 * 1000));
    if (targetDate > maxFuture) {
        return interaction.editReply({ 
            content: '[ × ] ไม่สามารถตั้งเวลาแจ้งเตือนเกินกว่าอนาคต 100 วันได้!' 
        });
    }

    const notificationContent = 
`## > Notification
### - ${title}
-# ${subtitle}
\`\`\`text
- ${text}
\`\`\``;

    try {
        const supabase = permissions.supabase;
        if (supabase) {
            let { data: userData } = await supabase
                .from('users')
                .select('id, is_dm_enabled')
                .eq('discord_id', interaction.user.id)
                .single();

            if (!userData) {
                const { data: newUser } = await supabase
                    .from('users')
                    .insert([{ 
                        discord_id: interaction.user.id, 
                        username: interaction.user.tag, 
                        role: userRole || 'user',
                        is_dm_enabled: true 
                    }])
                    .select('id, is_dm_enabled')
                    .single();
                if (newUser) userData = newUser;
            }

            await supabase.from('tasks').insert([{
                server_id: interaction.guildId || 'DM',
                subject: title,
                description: JSON.stringify({ subtitle, text, color }),
                start_date: now.toISOString(),
                due_date: targetDate.toISOString(),
                created_by: userData ? userData.id : null
            }]);

            await permissions.addAuditLog(
                'ADD_NOTIFICATION', 
                interaction.user.id, 
                `Created notification task: "${title}" due at ${targetDate.toISOString()}`
            );

            if (userData && userData.is_dm_enabled === false) {
                return interaction.editReply({ 
                    content: `[ ✓ ] บันทึกข้อมูลลง Supabase แล้ว แต่บัญชีของคุณถูกปิดการใช้งาน DM (` + "`is_dm_enabled = false`" + `) จึงไม่มีการส่งข้อความส่วนตัว` 
                });
            }
        }

        const delayMs = targetDate.getTime() - now.getTime();
        setTimeout(async () => {
            try {
                const embed = new EmbedBuilder()
                    .setDescription(notificationContent)
                    .setColor(color)
                    .setTimestamp();

                await interaction.user.send({ embeds: [embed] });
            } catch (dmErr) {
                console.error(`[ Notification Error ] ไม่สามารถส่ง DM หา ${interaction.user.tag}:`, dmErr.message);
            }
        }, delayMs);

        const formattedDateStr = targetDate.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        return interaction.editReply({ 
            content: `[ ✓ ] บันทึกข้อมูลลงฐานข้อมูลและตั้งการแจ้งเตือนเรียบร้อยแล้ว!\n- **วันเวลาที่แจ้งเตือน:** ${formattedDateStr}\n\n${notificationContent}` 
        });

    } catch (err) {
        console.error('Error in /add notification command:', err);
        return interaction.editReply({ 
            content: '[ × ] เกิดข้อผิดพลาดในการบันทึกหรือตั้งการแจ้งเตือน' 
        });
    }
}

module.exports = { getCommand, handle };
