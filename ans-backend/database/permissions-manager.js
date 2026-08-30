const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 1. ตรวจสอบสิทธิ์และดึง Role ของผู้ใช้ (บทบาทหลัก)
async function getUserRole(discordId, superAdminId) {
  if (discordId === superAdminId) return 'admin';

  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('discord_id', discordId)
    .single();

  if (error || !data) return null;
  return data.role;
}

// 2. ตรวจสอบว่ามีสิทธิ์ใช้งานทั่วไปไหม
async function hasPermission(discordId, superAdminId) {
  const role = await getUserRole(discordId, superAdminId);
  return role !== null;
}

// 3. เพิ่มหรืออัปเดตผู้ใช้ (Upsert) อิงตามโครงสร้างตาราง users
async function addUser(discordId, username, role = 'user', isDmEnabled = true) {
  const { error } = await supabase
    .from('users')
    .upsert(
      [{ discord_id: discordId, username: username, role: role, is_dm_enabled: isDmEnabled }],
      { onConflict: 'discord_id' }
    );

  if (error) {
    console.error('Error adding/updating user in Supabase:', error.message);
    return false;
  }
  return true;
}

// 4. ลบผู้ใช้ตาม Discord ID
async function removeUser(discordId) {
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('discord_id', discordId);

  if (error) {
    console.error('Error removing user from Supabase:', error.message);
    return false;
  }
  return true;
}

// 5. ดึงรายชื่อผู้ใช้ทั้งหมดจาก Supabase
async function getAllUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('*');

  if (error) {
    console.error('Error fetching users from Supabase:', error.message);
    return [];
  }

  return data.map(u => ({
    id: u.discord_id,
    username: u.username,
    role: u.role,
    is_dm_enabled: u.is_dm_enabled
  }));
}

// 6. เพิ่ม Task / การแจ้งเตือนลงในตาราง tasks
async function addTask(discordId, serverId, subject, description, startDate, dueDate) {
  let { data: userData, error: userErr } = await supabase
    .from('users')
    .select('id, is_dm_enabled')
    .eq('discord_id', discordId)
    .single();

  if (userErr || !userData) {
    const { data: newUser } = await supabase
      .from('users')
      .insert([{ discord_id: discordId, username: 'User_' + discordId, role: 'user', is_dm_enabled: true }])
      .select('id, is_dm_enabled')
      .single();
    if (newUser) userData = newUser;
  }

  const userId = userData ? userData.id : null;

  const { error } = await supabase
    .from('tasks')
    .insert([{
      server_id: serverId,
      subject: subject,
      description: description,
      start_date: startDate,
      due_date: dueDate,
      created_by: userId
    }]);

  if (error) {
    console.error('Error adding task to Supabase:', error.message);
    return false;
  }
  return true;
}

// 7. บันทึก Audit Logs
async function addAuditLog(action, discordId, details) {
  let userId = null;
  if (discordId) {
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('discord_id', discordId)
      .single();
    if (userData) userId = userData.id;
  }

  await supabase
    .from('audit_logs')
    .insert([{
      action: action,
      performed_by: userId,
      details: details
    }]);
}

module.exports = { 
  getUserRole, 
  hasPermission, 
  addUser, 
  removeUser, 
  getAllUsers, 
  addTask,
  addAuditLog,
  supabase 
};
