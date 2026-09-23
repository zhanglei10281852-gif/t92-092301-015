const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { seedDatabase } = require('../src/seed');

describe('elderly meal service API', () => {
  let db;
  let app;
  let adminToken;
  let canteenToken;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    seedDatabase(db);
    app = createApp({ db, jwtSecret: 'test-secret' });
    adminToken = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'Pass@2024' })).body.token;
    canteenToken = (await request(app).post('/api/auth/login').send({ username: 'canteen1', password: 'cc123' })).body.token;
  });

  afterEach(() => db.close());

  test('health and login expose a usable API', async () => {
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    const profile = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${adminToken}`);
    expect(profile.status).toBe(200);
    expect(profile.body.role).toBe('admin');
  });

  test('rejects missing credentials and enforces role permissions', async () => {
    expect((await request(app).get('/api/elderly')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' })).status).toBe(401);
    expect((await request(app).post('/api/canteens').set('Authorization', `Bearer ${canteenToken}`).send({ name: 'x' })).status).toBe(403);
  });

  test('lists elderly records and creates an order with subsidy calculation', async () => {
    const elderlyResponse = await request(app).get('/api/elderly?pageSize=10').set('Authorization', `Bearer ${adminToken}`);
    expect(elderlyResponse.status).toBe(200);
    expect(elderlyResponse.body.total).toBe(4);
    const elderlyId = elderlyResponse.body.list[0].id;
    const mealDate = new Date();
    mealDate.setUTCDate(mealDate.getUTCDate() + 1);
    const orderResponse = await request(app).post('/api/orders').set('Authorization', `Bearer ${adminToken}`).send({
      elderlyId,
      canteenId: 1,
      mealDate: mealDate.toISOString().slice(0, 10),
      mealType: 'lunch',
      mealStandard: 'B',
      deliveryType: 'pickup',
    });
    expect(orderResponse.status).toBe(201);
    expect(orderResponse.body.mealPrice).toBe(15);
    expect(orderResponse.body.subsidyAmount).toBeGreaterThan(0);
  });

  test('completing an order creates one subsidy record and updates quota', async () => {
    const mealDate = new Date();
    mealDate.setUTCDate(mealDate.getUTCDate() + 1);
    const created = await request(app).post('/api/orders').set('Authorization', `Bearer ${adminToken}`).send({ elderlyId: 1, canteenId: 1, mealDate: mealDate.toISOString().slice(0, 10), mealType: 'dinner', mealStandard: 'A' });
    expect(created.status).toBe(201);
    const orderId = created.body.id;
    expect((await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${canteenToken}`).send({ status: 'completed' })).status).toBe(200);
    const month = mealDate.toISOString().slice(0, 7);
    const summary = await request(app).get(`/api/subsidy/monthly-summary?month=${month}`).set('Authorization', `Bearer ${adminToken}`);
    expect(summary.status).toBe(200);
    expect(summary.body.list).toHaveLength(1);
    expect(summary.body.quota.usedAmount).toBeGreaterThan(0);
    const repeat = await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${canteenToken}`).send({ status: 'completed' });
    expect(repeat.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS count FROM subsidy_records').get().count).toBe(1);
  });

  test('dashboard returns scoped operational statistics', async () => {
    const response = await request(app).get('/api/dashboard/stats').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.totalElderly).toBe(4);
    expect(response.body.dailyTrend).toHaveLength(30);
  });
});
