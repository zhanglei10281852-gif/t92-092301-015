const jwt = require('jsonwebtoken');
const config = require('./config');

function publicUser(row) {
  return { id: row.id, username: row.username, name: row.name, role: row.role, canteenId: row.canteen_id ?? null };
}

function authenticate(req, res, next) {
  const token = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: '未授权，请先登录' });
  try {
    const payload = jwt.verify(token, req.app.locals.jwtSecret || config.jwtSecret);
    const user = req.db.prepare('SELECT id, username, name, role, canteen_id FROM users WHERE id = ?').get(payload.userId);
    if (!user) return res.status(401).json({ message: '用户不存在' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Token 无效或已过期' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: '未授权' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: '权限不足' });
    next();
  };
}

module.exports = { authenticate, requireRoles, publicUser };
