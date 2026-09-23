const bcrypt = require('bcryptjs');
const config = require('./config');
const { createDatabase } = require('./db');

const canteens = [
  { name: '幸福社区食堂', address: '幸福路 1 号', phone: '021-60000001', capacity: 80 },
  { name: '阳光助餐点', address: '阳光路 8 号', phone: '021-60000002', capacity: 60 },
];

const elderly = [
  { name: '张秀兰', idCard: '310101194503010021', age: 81, gender: 'female', community: '幸福社区', phone: '13800000001', address: '幸福社区 1 栋 101', category: 'low_income_full', canteen: 1 },
  { name: '李建国', idCard: '310101195206120035', age: 74, gender: 'male', community: '阳光社区', phone: '13800000002', address: '阳光社区 2 栋 201', category: 'low_income', canteen: 2 },
  { name: '王淑芬', idCard: '310101194012200046', age: 85, gender: 'female', community: '幸福社区', phone: '13800000003', address: '幸福社区 3 栋 302', category: 'normal', canteen: 1 },
  { name: '赵明远', idCard: '310101195807080057', age: 67, gender: 'male', community: '阳光社区', phone: '13800000004', address: '阳光社区 4 栋 402', category: 'senior_extra', canteen: 2 },
];

function seedDatabase(db, { reset = true } = {}) {
  const run = db.transaction(() => {
    if (reset) {
      db.exec('DELETE FROM subsidy_records; DELETE FROM orders; DELETE FROM elderly; DELETE FROM users; DELETE FROM canteens; DELETE FROM monthly_quotas;');
    }
    const canteenIds = [];
    const insertCanteen = db.prepare('INSERT INTO canteens (name, address, phone, daily_capacity, lunch_hours, dinner_hours) VALUES (?, ?, ?, ?, ?, ?)');
    for (const item of canteens) canteenIds.push(Number(insertCanteen.run(item.name, item.address, item.phone, item.capacity, '11:00-13:00', '17:00-19:00').lastInsertRowid));

    const insertUser = db.prepare('INSERT INTO users (username, password_hash, role, name, canteen_id) VALUES (?, ?, ?, ?, ?)');
    insertUser.run('admin', bcrypt.hashSync('Pass@2024', 10), 'admin', '系统管理员', null);
    insertUser.run('worker1', bcrypt.hashSync('wk123', 10), 'worker', '社区工作人员', null);
    insertUser.run('canteen1', bcrypt.hashSync('cc123', 10), 'canteen', '幸福社区食堂管理员', canteenIds[0]);
    insertUser.run('canteen2', bcrypt.hashSync('cc123', 10), 'canteen', '阳光助餐点管理员', canteenIds[1]);

    const insertElderly = db.prepare(`INSERT INTO elderly (name, id_card, age, gender, community, phone, address, subsidy_category, canteen_id, has_senior_subsidy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of elderly) insertElderly.run(item.name, item.idCard, item.age, item.gender, item.community, item.phone, item.address, item.category, canteenIds[item.canteen - 1], item.age >= 80 ? 1 : 0);

    const month = new Date().toISOString().slice(0, 7);
    db.prepare('INSERT INTO monthly_quotas (month, total_quota, used_amount, remaining_amount, status) VALUES (?, ?, 0, ?, ?)').run(month, config.monthlySubsidyQuota, config.monthlySubsidyQuota, 'active');
    return { canteens: canteenIds.length, elderly: elderly.length, users: 4 };
  });
  return run();
}

if (require.main === module) {
  const db = createDatabase(config.dbPath);
  const result = seedDatabase(db, { reset: true });
  db.close();
  console.log(`Seed complete: ${result.users} users, ${result.canteens} canteens, ${result.elderly} elderly records`);
}

module.exports = { seedDatabase };
