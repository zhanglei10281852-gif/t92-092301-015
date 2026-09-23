# 社区老年人助餐服务 API

一个用于接口练习和业务规则演示的纯后端服务。项目保留了原助餐平台的核心业务，但已经移除前端和 MongoDB，改为单服务 Express API + SQLite，支持在本地或 Docker 中一键运行。

## 功能范围

- JWT 登录与角色权限：`admin`、`worker`、`canteen`
- 老人档案和助餐点管理
- 助餐订单创建、查询、取消、状态流转和配送信息
- 按老人补贴类别和高龄规则计算补贴与自付金额
- 月度补贴额度、分类统计和 CSV 导出
- 面向运营数据的 Dashboard 统计接口

## 技术栈

- Node.js 20+
- Express 4
- SQLite（`better-sqlite3`）
- JWT、bcryptjs
- Jest + Supertest

## 快速开始

```bash
cd backend
npm install
cp .env.example .env       # Windows 可手动复制文件
npm run init-db
npm run seed
npm start
```

服务默认监听 `http://localhost:6847`，健康检查：

```bash
curl http://localhost:6847/api/health
```

也可以直接使用 Docker：

```bash
docker compose up --build
```

首次需要演示数据时，另开终端执行一次：

```bash
docker compose run --rm api node src/seed.js
```

Compose 不会在每次重启时自动清空数据库。

SQLite 文件默认位于 `backend/data/elderly-meal.sqlite3`。`npm run seed` 会清空并重新生成演示数据，生产环境不要在已有数据上执行。

## 演示账号

| 角色 | 用户名 | 密码 |
| --- | --- | --- |
| 管理员 | `admin` | `Pass@2024` |
| 社区工作人员 | `worker1` | `wk123` |
| 助餐点管理员 | `canteen1` | `cc123` |
| 助餐点管理员 | `canteen2` | `cc123` |

演示密码仅用于本地演示环境。部署前应修改密码、`JWT_SECRET` 和数据库路径。

## API 概览

所有除 `/api/health` 和登录接口外的接口都需要请求头：`Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/login` | 登录并获取 JWT |
| `GET` | `/api/auth/profile` | 当前用户信息 |
| `GET` | `/api/dashboard/stats` | 运营统计 |
| `GET/POST/PUT/DELETE` | `/api/elderly` | 老人档案 |
| `GET/POST/PUT/DELETE` | `/api/canteens` | 助餐点 |
| `GET/POST/PATCH/DELETE` | `/api/orders` | 订单与状态流转 |
| `GET` | `/api/subsidy/monthly-summary` | 月度汇总 |
| `GET` | `/api/subsidy/quota` | 月度额度 |
| `GET` | `/api/subsidy/category-stats` | 补贴类别统计 |
| `GET` | `/api/subsidy/export-csv` | 导出 CSV |

订单状态：`ordered` → `confirmed` → `preparing` → `ready` → `completed`，也可以取消为 `cancelled`。订单完成时才会生成补贴结算记录，并且同一订单不会重复计入额度。

## 测试

测试使用独立的内存 SQLite 数据库，不需要启动服务，也不会修改 `backend/data`：

```bash
cd backend
npm test
```

测试覆盖健康检查、登录、无权限访问、老人列表、订单创建、补贴计算、订单完成结算和 Dashboard 统计。

## 构建检查

本项目不生成前端或编译产物，发布前使用 Node.js 语法检查验证服务端入口和核心模块：

```bash
cd backend
npm run build
```

## 环境变量

参见 [`backend/.env.example`](backend/.env.example)：

- `PORT`：HTTP 端口，默认 `6847`
- `DB_PATH`：SQLite 文件路径
- `JWT_SECRET`：JWT 签名密钥
- `JWT_EXPIRES_IN`：Token 有效期，默认 `24h`
- `MONTHLY_SUBSIDY_QUOTA`：每月补贴额度，默认 `100000`

## 目录结构

```text
backend/
  src/
    app.js       # Express 应用和 API 路由
    db.js        # SQLite schema 与连接
    auth.js      # JWT 认证与角色权限
    subsidy.js   # 补贴规则
    seed.js      # 可重复执行的演示数据
    init.js      # 创建数据库结构
    server.js    # 生产启动入口
  tests/api.test.js
```

本项目没有前端构建产物，没有 MongoDB 依赖，也不需要外部服务即可运行测试。
