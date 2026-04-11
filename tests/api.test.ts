import request from 'supertest';
import app from '../src/app';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let tOrg: string, tU1: string, tU2: string;
let eventId: number;

beforeAll(async () => {
  await prisma.rSVP.deleteMany(); await prisma.event.deleteMany(); await prisma.user.deleteMany();
  await request(app).post('/auth/register').send({ email: 'o@t.com', password: 'pw' });
  await request(app).post('/auth/register').send({ email: '1@t.com', password: 'pw' });
  await request(app).post('/auth/register').send({ email: '2@t.com', password: 'pw' });
  tOrg = (await request(app).post('/auth/login').send({ email: 'o@t.com', password: 'pw' })).body.token;
  tU1 = (await request(app).post('/auth/login').send({ email: '1@t.com', password: 'pw' })).body.token;
  tU2 = (await request(app).post('/auth/login').send({ email: '2@t.com', password: 'pw' })).body.token;
});

afterAll(async () => await prisma.$disconnect());

describe('API Tests', () => {
  it('Tier 1: Create event (Status)', async () => {
    const res = await request(app).post('/events').set('Authorization', `Bearer ${tOrg}`).send({ title: 'Test', capacity: 1 });
    expect(res.status).toBe(201);
    eventId = res.body.id;
  });

  it('Tier 2: Waitlist assignment (Body)', async () => {
    await request(app).post(`/events/${eventId}/rsvp`).set('Authorization', `Bearer ${tU1}`);
    const res = await request(app).post(`/events/${eventId}/rsvp`).set('Authorization', `Bearer ${tU2}`);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('WAITLISTED');
  });

  it('Tier 3: Waitlist promotion (State)', async () => {
    await request(app).delete(`/events/${eventId}/rsvp`).set('Authorization', `Bearer ${tU1}`);
    const res = await request(app).get(`/events/${eventId}/attendees`).set('Authorization', `Bearer ${tOrg}`);
    expect(res.body.confirmed.length).toBe(1);
    expect(res.body.confirmed[0].user.email).toBe('2@t.com');
  });
});