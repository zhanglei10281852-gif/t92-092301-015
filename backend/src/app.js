const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { authenticate, requireRoles, publicUser } = require('./auth');
const { MEAL_PRICES, calculateSubsidy, monthKey, orderNumber } = require('./subsidy');

const VALID_STATUSES = ['ordered', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
const VALID_CATEGORIES = ['low_income_full', 'low_income', 'normal', 'senior_extra'];

function pageParams(query) {
  const page = Math.max(1, Number.parseInt(query.page || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize || '10', 10) || 10));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowIso() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function mapElderly(row) {
  if (!row) return null;
  return { ...row, idCard: row.id_card, subsidyCategory: row.subsidy_category, canteenId: row.canteen_id, hasSeniorSubsidy: Boolean(row.has_senior_subsidy) };
}

function mapCanteen(row) {
  if (!row) return null;
  return { ...row, dailyCapacity: row.daily_capacity, businessHours: { lunch: row.lunch_hours, dinner: row.dinner_hours } };
}

function mapOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    orderNo: row.order_no,
    elderlyId: row.elderly_id,
    canteenId: row.canteen_id,
    mealDate: row.meal_date,
    mealType: row.meal_type,
    mealStandard: row.meal_standard,
    mealPrice: row.meal_price,
    remark: row.remark,
    status: row.status,
    deliveryType: row.delivery_type,
    deliveryInfo: row.volunteer_name ? { volunteerName: row.volunteer_name, estimatedTime: row.estimated_time, actualTime: row.actual_time } : undefined,
    subsidyAmount: row.subsidy_amount,
    selfPayAmount: row.self_pay_amount,
    createdBy: row.created_by,
    confirmedAt: row.confirmed_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    elderly: row.elderly_name ? { id: row.elderly_id, name: row.elderly_name, age: row.elderly_age, phone: row.elderly_phone, subsidyCategory: row.elderly_subsidy_category } : undefined,
    canteen: row.canteen_name ? { id: row.canteen_id, name: row.canteen_name } : undefined,
  };
}

function orderSelect(db, id) {
  return db.prepare(`
    SELECT o.*, e.name AS elderly_name, e.age AS elderly_age, e.phone AS elderly_phone,
      e.subsidy_category AS elderly_subsidy_category, c.name AS canteen_name
    FROM orders o JOIN elderly e ON e.id = o.elderly_id JOIN canteens c ON c.id = o.canteen_id
    WHERE o.id = ?
  `).get(id);
}

function ensureQuota(db, month) {
  let quota = db.prepare('SELECT * FROM monthly_quotas WHERE month = ?').get(month);
  if (!quota) {
    db.prepare('INSERT INTO monthly_quotas (month, total_quota, used_amount, remaining_amount, status) VALUES (?, ?, 0, ?, ?)')
      .run(month, config.monthlySubsidyQuota, config.monthlySubsidyQuota, 'active');
    quota = db.prepare('SELECT * FROM monthly_quotas WHERE month = ?').get(month);
  }
  return { totalQuota: quota.total_quota, usedAmount: quota.used_amount, remainingAmount: quota.remaining_amount, status: quota.status };
}

function createApp({ db, jwtSecret = config.jwtSecret } = {}) {
  if (!db) throw new Error('createApp requires a SQLite database connection');
  const app = express();
  app.locals.jwtSecret = jwtSecret;
  app.use(cors());
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', message: '老年人助餐服务平台 API 运行正常' }));

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !password || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ message: '用户名或密码错误' });
    const token = jwt.sign({ userId: user.id, role: user.role }, jwtSecret, { expiresIn: config.jwtExpiresIn });
    res.json({ token, user: publicUser(user) });
  });

  app.get('/api/auth/profile', authenticate, (req, res) => res.json(publicUser(req.user)));

  app.get('/api/canteens', authenticate, (req, res) => {
    const rows = db.prepare('SELECT * FROM canteens ORDER BY id').all().map(mapCanteen);
    res.json(rows);
  });
  app.get('/api/canteens/:id', authenticate, (req, res) => {
    const row = db.prepare('SELECT * FROM canteens WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ message: '助餐点不存在' });
    res.json(mapCanteen(row));
  });
  app.post('/api/canteens', authenticate, requireRoles('admin'), (req, res) => {
    const { name, address, phone, dailyCapacity, businessHours = {} } = req.body || {};
    if (!name || !address || !phone || dailyCapacity === undefined) return res.status(400).json({ message: '请填写完整的助餐点信息' });
    const result = db.prepare('INSERT INTO canteens (name, address, phone, daily_capacity, lunch_hours, dinner_hours) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, address, phone, Number(dailyCapacity), businessHours.lunch || '11:00-13:00', businessHours.dinner || '17:00-19:00');
    res.status(201).json(mapCanteen(db.prepare('SELECT * FROM canteens WHERE id = ?').get(result.lastInsertRowid)));
  });
  app.put('/api/canteens/:id', authenticate, requireRoles('admin'), (req, res) => {
    const current = db.prepare('SELECT * FROM canteens WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ message: '助餐点不存在' });
    const body = req.body || {};
    db.prepare(`UPDATE canteens SET name = ?, address = ?, phone = ?, daily_capacity = ?, lunch_hours = ?, dinner_hours = ?, status = ? WHERE id = ?`)
      .run(body.name ?? current.name, body.address ?? current.address, body.phone ?? current.phone, Number(body.dailyCapacity ?? current.daily_capacity), body.businessHours?.lunch ?? current.lunch_hours, body.businessHours?.dinner ?? current.dinner_hours, body.status ?? current.status, req.params.id);
    res.json(mapCanteen(db.prepare('SELECT * FROM canteens WHERE id = ?').get(req.params.id)));
  });
  app.delete('/api/canteens/:id', authenticate, requireRoles('admin'), (req, res) => {
    const result = db.prepare("UPDATE canteens SET status = 'inactive' WHERE id = ?").run(req.params.id);
    if (!result.changes) return res.status(404).json({ message: '助餐点不存在' });
    res.json({ message: '助餐点已停用' });
  });

  app.use('/api/elderly', authenticate, requireRoles('admin', 'worker'));
  app.get('/api/elderly', (req, res) => {
    const { page, pageSize, offset } = pageParams(req.query);
    const filters = []; const args = [];
    if (req.query.keyword) { filters.push('(e.name LIKE ? OR e.id_card LIKE ? OR e.phone LIKE ?)'); args.push(`%${req.query.keyword}%`, `%${req.query.keyword}%`, `%${req.query.keyword}%`); }
    if (req.query.community) { filters.push('e.community = ?'); args.push(req.query.community); }
    if (req.query.subsidyCategory) { filters.push('e.subsidy_category = ?'); args.push(req.query.subsidyCategory); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM elderly e ${where}`).get(...args).count;
    const list = db.prepare(`SELECT e.*, c.name AS canteen_name FROM elderly e JOIN canteens c ON c.id = e.canteen_id ${where} ORDER BY e.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset)
      .map((row) => ({ ...mapElderly(row), canteen: { id: row.canteen_id, name: row.canteen_name } }));
    res.json({ total, list, page, pageSize });
  });
  app.get('/api/elderly/:id', (req, res) => {
    const row = db.prepare('SELECT e.*, c.name AS canteen_name FROM elderly e JOIN canteens c ON c.id = e.canteen_id WHERE e.id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ message: '老人信息不存在' });
    res.json({ ...mapElderly(row), canteen: { id: row.canteen_id, name: row.canteen_name } });
  });
  app.post('/api/elderly', (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.idCard || !b.age || !b.gender || !b.community || !b.phone || !b.address || !VALID_CATEGORIES.includes(b.subsidyCategory) || !b.canteenId) return res.status(400).json({ message: '请填写完整的老人信息' });
    try {
      const result = db.prepare(`INSERT INTO elderly (name, id_card, age, gender, community, phone, address, subsidy_category, canteen_id, has_senior_subsidy, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(b.name, b.idCard, Number(b.age), b.gender, b.community, b.phone, b.address, b.subsidyCategory, b.canteenId, b.hasSeniorSubsidy ? 1 : 0, b.status || 'active');
      res.status(201).json(mapElderly(db.prepare('SELECT * FROM elderly WHERE id = ?').get(result.lastInsertRowid)));
    } catch (error) { if (String(error.message).includes('UNIQUE')) return res.status(400).json({ message: '身份证号已存在' }); throw error; }
  });
  app.put('/api/elderly/:id', (req, res) => {
    const current = db.prepare('SELECT * FROM elderly WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ message: '老人信息不存在' });
    const b = req.body || {};
    try {
      db.prepare(`UPDATE elderly SET name=?, id_card=?, age=?, gender=?, community=?, phone=?, address=?, subsidy_category=?, canteen_id=?, has_senior_subsidy=?, status=? WHERE id=?`)
        .run(b.name ?? current.name, b.idCard ?? current.id_card, Number(b.age ?? current.age), b.gender ?? current.gender, b.community ?? current.community, b.phone ?? current.phone, b.address ?? current.address, b.subsidyCategory ?? current.subsidy_category, b.canteenId ?? current.canteen_id, b.hasSeniorSubsidy === undefined ? current.has_senior_subsidy : (b.hasSeniorSubsidy ? 1 : 0), b.status ?? current.status, req.params.id);
      res.json(mapElderly(db.prepare('SELECT * FROM elderly WHERE id = ?').get(req.params.id)));
    } catch (error) { if (String(error.message).includes('UNIQUE')) return res.status(400).json({ message: '身份证号已存在' }); throw error; }
  });
  app.delete('/api/elderly/:id', (req, res) => {
    const result = db.prepare("UPDATE elderly SET status = 'inactive' WHERE id = ?").run(req.params.id);
    if (!result.changes) return res.status(404).json({ message: '老人信息不存在' });
    res.json({ message: '老人已停用' });
  });

  app.use('/api/orders', authenticate);
  app.get('/api/orders', (req, res) => {
    const { page, pageSize, offset } = pageParams(req.query);
    const filters = []; const args = [];
    if (req.user.role === 'canteen') { filters.push('o.canteen_id = ?'); args.push(req.user.canteen_id); }
    else if (req.query.canteenId) { filters.push('o.canteen_id = ?'); args.push(req.query.canteenId); }
    if (req.query.status) { filters.push('o.status = ?'); args.push(req.query.status); }
    if (req.query.mealType) { filters.push('o.meal_type = ?'); args.push(req.query.mealType); }
    if (req.query.startDate) { filters.push('o.meal_date >= ?'); args.push(req.query.startDate); }
    if (req.query.endDate) { filters.push('o.meal_date <= ?'); args.push(req.query.endDate); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const base = `FROM orders o JOIN elderly e ON e.id=o.elderly_id JOIN canteens c ON c.id=o.canteen_id ${where}`;
    const total = db.prepare(`SELECT COUNT(*) AS count ${base}`).get(...args).count;
    const rows = db.prepare(`SELECT o.*, e.name AS elderly_name, e.age AS elderly_age, e.phone AS elderly_phone, e.subsidy_category AS elderly_subsidy_category, c.name AS canteen_name ${base} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset);
    res.json({ total, list: rows.map(mapOrder), page, pageSize });
  });
  app.get('/api/orders/:id', (req, res) => {
    const row = orderSelect(db, req.params.id);
    if (!row) return res.status(404).json({ message: '订单不存在' });
    if (req.user.role === 'canteen' && row.canteen_id !== req.user.canteen_id) return res.status(403).json({ message: '无权查看此订单' });
    res.json(mapOrder(row));
  });
  app.post('/api/orders', requireRoles('admin', 'worker'), (req, res) => {
    const b = req.body || {};
    if (!b.elderlyId || !b.canteenId || !isIsoDate(b.mealDate) || !['lunch', 'dinner'].includes(b.mealType) || !MEAL_PRICES[b.mealStandard]) return res.status(400).json({ message: '订单参数无效' });
    if (b.mealDate < tomorrowIso()) return res.status(400).json({ message: '只能预订明日及以后的餐食' });
    const elderly = db.prepare('SELECT * FROM elderly WHERE id = ? AND status = \'active\'').get(b.elderlyId);
    const canteen = db.prepare('SELECT * FROM canteens WHERE id = ? AND status = \'active\'').get(b.canteenId);
    if (!elderly) return res.status(404).json({ message: '老人信息不存在' });
    if (!canteen) return res.status(404).json({ message: '助餐点不存在' });
    const count = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE canteen_id=? AND meal_date=? AND meal_type=? AND status <> 'cancelled'").get(b.canteenId, b.mealDate, b.mealType).count;
    if (count >= canteen.daily_capacity) return res.status(400).json({ message: '该助餐点当前餐次已达到最大供应能力' });
    const subsidy = calculateSubsidy(elderly, MEAL_PRICES[b.mealStandard]);
    const result = db.prepare(`INSERT INTO orders (order_no, elderly_id, canteen_id, meal_date, meal_type, meal_standard, meal_price, remark, delivery_type, subsidy_amount, self_pay_amount, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(orderNumber(), b.elderlyId, b.canteenId, b.mealDate, b.mealType, b.mealStandard, MEAL_PRICES[b.mealStandard], b.remark || '', b.deliveryType || 'pickup', subsidy.totalSubsidy, subsidy.selfPayAmount, req.user.id);
    res.status(201).json(mapOrder(orderSelect(db, result.lastInsertRowid)));
  });
  app.patch('/api/orders/:id/status', requireRoles('admin', 'canteen'), (req, res) => {
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    const status = req.body?.status;
    if (!row) return res.status(404).json({ message: '订单不存在' });
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ message: '无效的订单状态' });
    if (req.user.role === 'canteen' && row.canteen_id !== req.user.canteen_id) return res.status(403).json({ message: '无权操作此订单' });
    const now = new Date().toISOString();
    const complete = db.transaction(() => {
      db.prepare('UPDATE orders SET status=?, confirmed_at=?, completed_at=? WHERE id=?').run(status, status === 'confirmed' ? now : row.confirmed_at, status === 'completed' ? now : row.completed_at, req.params.id);
      if (status === 'completed' && !db.prepare('SELECT 1 FROM subsidy_records WHERE order_id=?').get(req.params.id)) {
        const elderly = db.prepare('SELECT * FROM elderly WHERE id=?').get(row.elderly_id);
        const subsidy = calculateSubsidy(elderly, row.meal_price); const month = monthKey(row.meal_date); const quota = ensureQuota(db, month);
        db.prepare(`INSERT INTO subsidy_records (order_id, elderly_id, canteen_id, meal_date, subsidy_category, base_subsidy, senior_subsidy, total_subsidy, meal_price, self_pay_amount, month) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(row.id, row.elderly_id, row.canteen_id, row.meal_date, elderly.subsidy_category, subsidy.baseSubsidy, subsidy.seniorSubsidy, subsidy.totalSubsidy, row.meal_price, subsidy.selfPayAmount, month);
        const used = quota.usedAmount + subsidy.totalSubsidy; const remaining = Math.max(0, quota.totalQuota - used);
        db.prepare('UPDATE monthly_quotas SET used_amount=?, remaining_amount=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE month=?').run(used, remaining, remaining > 0 ? 'active' : 'exhausted', month);
      }
    });
    complete();
    res.json(mapOrder(orderSelect(db, req.params.id)));
  });
  app.patch('/api/orders/:id/delivery', requireRoles('admin', 'canteen'), (req, res) => {
    const row = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ message: '订单不存在' });
    if (req.user.role === 'canteen' && row.canteen_id !== req.user.canteen_id) return res.status(403).json({ message: '无权操作此订单' });
    if (!req.body?.volunteerName || !req.body?.estimatedTime) return res.status(400).json({ message: '请填写完整配送信息' });
    db.prepare("UPDATE orders SET delivery_type='delivery', volunteer_name=?, estimated_time=? WHERE id=?").run(req.body.volunteerName, req.body.estimatedTime, req.params.id);
    res.json(mapOrder(orderSelect(db, req.params.id)));
  });
  app.delete('/api/orders/:id', requireRoles('admin', 'worker'), (req, res) => {
    const result = db.prepare("UPDATE orders SET status='cancelled' WHERE id=? AND status <> 'completed'").run(req.params.id);
    if (!result.changes) return res.status(404).json({ message: '订单不存在或已完成' });
    res.json({ message: '订单已取消' });
  });

  app.get('/api/dashboard/stats', authenticate, (req, res) => {
    const scope = req.user.role === 'canteen' ? ' AND o.canteen_id = ?' : ''; const args = req.user.role === 'canteen' ? [req.user.canteen_id] : [];
    const today = todayIso(); const month = today.slice(0, 7);
    const todayOrders = db.prepare(`SELECT COUNT(*) AS count FROM orders o WHERE o.meal_date=? AND o.status <> 'cancelled'${scope}`).get(today, ...args).count;
    const totalElderly = db.prepare("SELECT COUNT(*) AS count FROM elderly WHERE status='active'").get().count;
    const totalCanteens = db.prepare("SELECT COUNT(*) AS count FROM canteens WHERE status='active'").get().count;
    const subsidy = db.prepare(`SELECT COALESCE(SUM(total_subsidy),0) AS total, COUNT(*) AS count FROM subsidy_records s WHERE s.month=?${req.user.role === 'canteen' ? ' AND s.canteen_id=?' : ''}`).get(month, ...(req.user.role === 'canteen' ? [req.user.canteen_id] : []));
    const quota = ensureQuota(db, month);
    const canteenOrders = db.prepare(`SELECT c.name AS canteenName, COUNT(*) AS count FROM orders o JOIN canteens c ON c.id=o.canteen_id WHERE o.meal_date=? AND o.status <> 'cancelled'${scope} GROUP BY o.canteen_id ORDER BY count DESC`).all(today, ...args);
    const dailyTrend = [];
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(); d.setUTCDate(d.getUTCDate() - i); const date = d.toISOString().slice(0, 10);
      dailyTrend.push({ date, count: db.prepare(`SELECT COUNT(*) AS count FROM orders o WHERE o.meal_date=? AND o.status <> 'cancelled'${scope}`).get(date, ...args).count });
    }
    res.json({ todayOrders, totalElderly, totalCanteens, monthSubsidyTotal: subsidy.total, monthSubsidyCount: subsidy.count, monthQuota: quota, canteenOrders, dailyTrend });
  });

  app.use('/api/subsidy', authenticate, requireRoles('admin', 'worker'));
  app.get('/api/subsidy/monthly-summary', (req, res) => {
    const month = req.query.month || todayIso().slice(0, 7); const { page, pageSize, offset } = pageParams(req.query);
    const total = db.prepare('SELECT COUNT(DISTINCT elderly_id) AS count FROM subsidy_records WHERE month=?').get(month).count;
    const list = db.prepare(`SELECT e.id AS elderly_id, e.name, e.id_card, e.community, e.subsidy_category, COUNT(s.id) AS meal_count, COALESCE(SUM(s.total_subsidy),0) AS total_subsidy, COALESCE(SUM(s.self_pay_amount),0) AS total_self_pay FROM subsidy_records s JOIN elderly e ON e.id=s.elderly_id WHERE s.month=? GROUP BY e.id ORDER BY e.name LIMIT ? OFFSET ?`).all(month, pageSize, offset)
      .map((r) => ({ elderlyId: r.elderly_id, name: r.name, idCard: r.id_card, community: r.community, subsidyCategory: r.subsidy_category, mealCount: r.meal_count, totalSubsidy: r.total_subsidy, totalSelfPay: r.total_self_pay }));
    res.json({ total, list, page, pageSize, quota: ensureQuota(db, month) });
  });
  app.get('/api/subsidy/quota', (req, res) => res.json(ensureQuota(db, req.query.month || todayIso().slice(0, 7))));
  app.get('/api/subsidy/category-stats', (req, res) => {
    const month = req.query.month || todayIso().slice(0, 7);
    res.json(db.prepare('SELECT subsidy_category AS category, COUNT(*) AS count, COALESCE(SUM(total_subsidy),0) AS total_subsidy FROM subsidy_records WHERE month=? GROUP BY subsidy_category ORDER BY total_subsidy DESC').all(month).map((r) => ({ category: r.category, count: r.count, totalSubsidy: r.total_subsidy })));
  });
  app.get('/api/subsidy/export-csv', (req, res) => {
    const month = req.query.month || todayIso().slice(0, 7);
    const rows = db.prepare('SELECT e.name, e.id_card, e.community, e.subsidy_category, COUNT(s.id) AS meal_count, COALESCE(SUM(s.total_subsidy),0) AS total_subsidy, COALESCE(SUM(s.self_pay_amount),0) AS total_self_pay FROM subsidy_records s JOIN elderly e ON e.id=s.elderly_id WHERE s.month=? GROUP BY e.id ORDER BY e.name').all(month);
    const csv = [['姓名', '身份证号', '社区', '补贴类别', '用餐次数', '补贴总额', '自付总额'], ...rows.map((r) => [r.name, r.id_card, r.community, r.subsidy_category, r.meal_count, r.total_subsidy.toFixed(2), r.total_self_pay.toFixed(2)])]
      .map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="subsidy-${month}.csv"` }).send(`\ufeff${csv}\n`);
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ message: '服务器内部错误' });
  });
  return app;
}

module.exports = { createApp };
