const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

function getCommands() {
  return [
    new SlashCommandBuilder()
      .setName('settext')
      .setDescription('• ส่งข้อความ Embed ไปยังช่องที่กำหนด')
      .addStringOption(opt => 
        opt.setName('text')
           .setDescription('• ข้อความที่ต้องการส่ง')
           .setRequired(true))
      .addStringOption(opt => 
        opt.setName('color')
           .setDescription('• เลือกสีของ Embed')
           .setRequired(true)
           .addChoices(
             { name: 'แดง', value: '#ff0000' },
             { name: 'แดงเข้ม', value: '#8b0000' },
             { name: 'ส้ม', value: '#ffa500' },
             { name: 'ส้มอิฐ', value: '#d2691e' },
             { name: 'เหลือง', value: '#ffff00' },
             { name: 'เขียว', value: '#008000' },
             { name: 'เขียวมะนาว', value: '#32cd32' },
             { name: 'ฟ้า', value: '#00bfff' },
             { name: 'น้ำเงิน', value: '#0000ff' },
             { name: 'น้ำเงินเข้ม', value: '#000080' },
             { name: 'ม่วง', value: '#800080' },
             { name: 'คราม', value: '#4b0082' },
             { name: 'ชมพู', value: '#ff1493' },
             { name: 'ทอง', value: '#ffd700' },
             { name: 'น้ำตาล', value: '#8b4513' },
             { name: 'ดำ', value: '#000000' },
             { name: 'เทา', value: '#808080' },
             { name: 'ขาว', value: '#ffffff' }
           ))
      .addChannelOption(opt => 
        opt.setName('channel')
           .setDescription('• ช่องปลายทางที่ต้องการส่งข้อความไป')
           .setRequired(true))
  ];
}

async function handle(interaction) {
  if (interaction.commandName === 'settext') {
    const text = interaction.options.getString('text');
    const color = interaction.options.getString('color');
    const channel = interaction.options.getChannel('channel');

    try {
      const embed = new EmbedBuilder().setDescription(text).setColor(color);
      
      // ส่งข้อความไปยังช่องปลายทางที่เลือก
      await channel.send({ embeds: [embed] });
      
      // ตอบกลับผู้ใช้แบบซ่อนตัว (Ephemeral) ด้วย editReply เนื่องจาก index.js สั่ง deferReply ไว้แล้ว
      return interaction.editReply({ content: "[ ✓ ] ส่งข้อความ Embed เรียบร้อย" });
    } catch (err) {
      console.error('Error in settext command:', err);
      return interaction.editReply({ content: "[ × ] เกิดข้อผิดพลาด ไม่สามารถส่งข้อความไปยังช่องดังกล่าวได้ (ตรวจสอบสิทธิ์การพิมพ์ของบอท)" });
    }
  }
}

module.exports = { getCommands, handle };
