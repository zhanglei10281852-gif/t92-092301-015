const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const schema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canteens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  daily_capacity INTEGER NOT NULL CHECK (daily_capacity >= 0),
  lunch_hours TEXT NOT NULL,
  dinner_hours TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'canteen', 'worker')),
  name TEXT NOT NULL,
  canteen_id INTEGER REFERENCES canteens(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS elderly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  id_card TEXT NOT NULL UNIQUE,
  age INTEGER NOT NULL CHECK (age >= 0),
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  community TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  subsidy_category TEXT NOT NULL CHECK (subsidy_category IN ('low_income_full', 'low_income', 'normal', 'senior_extra')),
  canteen_id INTEGER NOT NULL REFERENCES canteens(id),
  has_senior_subsidy INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  elderly_id INTEGER NOT NULL REFERENCES elderly(id),
  canteen_id INTEGER NOT NULL REFERENCES canteens(id),
  meal_date TEXT NOT NULL,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('lunch', 'dinner')),
  meal_standard TEXT NOT NULL CHECK (meal_standard IN ('A', 'B', 'C')),
  meal_price REAL NOT NULL CHECK (meal_price >= 0),
  remark TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled')),
  delivery_type TEXT NOT NULL DEFAULT 'pickup' CHECK (delivery_type IN ('pickup', 'delivery')),
  volunteer_name TEXT,
  estimated_time TEXT,
  actual_time TEXT,
  subsidy_amount REAL NOT NULL DEFAULT 0,
  self_pay_amount REAL NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  confirmed_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(canteen_id, meal_date, meal_type, status);
CREATE INDEX IF NOT EXISTS idx_orders_elderly ON orders(elderly_id, meal_date);

CREATE TABLE IF NOT EXISTS subsidy_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  elderly_id INTEGER NOT NULL REFERENCES elderly(id),
  canteen_id INTEGER NOT NULL REFERENCES canteens(id),
  meal_date TEXT NOT NULL,
  subsidy_category TEXT NOT NULL,
  base_subsidy REAL NOT NULL DEFAULT 0,
  senior_subsidy REAL NOT NULL DEFAULT 0,
  total_subsidy REAL NOT NULL DEFAULT 0,
  meal_price REAL NOT NULL DEFAULT 0,
  self_pay_amount REAL NOT NULL DEFAULT 0,
  month TEXT NOT NULL,
  settled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subsidy_month_elderly ON subsidy_records(month, elderly_id);
CREATE INDEX IF NOT EXISTS idx_subsidy_month_canteen ON subsidy_records(month, canteen_id);

CREATE TABLE IF NOT EXISTS monthly_quotas (
  month TEXT PRIMARY KEY,
  total_quota REAL NOT NULL,
  used_amount REAL NOT NULL DEFAULT 0,
  remaining_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'exhausted')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

function createDatabase(filename) {
  const target = filename || path.join(__dirname, '..', 'data', 'elderly-meal.sqlite3');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  return db;
}

module.exports = { createDatabase, schema };
