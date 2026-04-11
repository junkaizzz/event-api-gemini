import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
const prisma = new PrismaClient();
app.use(express.json());

const JWT_SECRET = 'study-secret-key';

// Mock Notifier
const Notifier = {
  send: (email: string, msg: string) => console.log(`[MOCK EMAIL to ${email}]: ${msg}`)
};

interface AuthRequest extends Request { user?: { id: number; email: string }; }

const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET) as { id: number; email: string };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

app.post('/auth/register', async (req, res) => {
  const { email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({ data: { email, password: hashedPassword } });
    res.status(201).json({ id: user.id, email: user.email });
  } catch (e) {
    res.status(400).json({ error: 'Email exists' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: jwt.sign({ id: user.id, email: user.email }, JWT_SECRET) });
});

app.post('/events', authenticate, async (req: AuthRequest, res) => {
  const { title, description, capacity } = req.body;
  if (capacity <= 0) return res.status(400).json({ error: 'Capacity > 0 required' });
  const event = await prisma.event.create({ data: { title, description, capacity, organizerId: req.user!.id } });
  res.status(201).json(event);
});

app.post('/events/:id/invite', authenticate, async (req: AuthRequest, res) => {
  const event = await prisma.event.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!event || event.organizerId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });
  Notifier.send(req.body.email, `Invited to ${event.title}`);
  res.json({ message: 'Sent' });
});

app.get('/events/:id/attendees', authenticate, async (req: AuthRequest, res) => {
  const rsvps = await prisma.rSVP.findMany({ where: { eventId: parseInt(req.params.id) }, include: { user: true }, orderBy: { createdAt: 'asc' } });
  res.json({
    confirmed: rsvps.filter(r => r.status === 'CONFIRMED'),
    waitlisted: rsvps.filter(r => r.status === 'WAITLISTED')
  });
});

app.post('/events/:id/rsvp', authenticate, async (req: AuthRequest, res) => {
  const eventId = parseInt(req.params.id);
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { rsvps: { where: { status: 'CONFIRMED' } } } });
  if (!event) return res.status(404).json({ error: 'Not found' });
  const status = event.rsvps.length >= event.capacity ? 'WAITLISTED' : 'CONFIRMED';
  try {
    const rsvp = await prisma.rSVP.create({ data: { eventId, userId: req.user!.id, status } });
    if (status === 'CONFIRMED') Notifier.send(req.user!.email, `RSVP Confirmed for ${event.title}`);
    res.status(201).json(rsvp);
  } catch (e) { res.status(400).json({ error: 'Already RSVPd' }); }
});

app.delete('/events/:id/rsvp', authenticate, async (req: AuthRequest, res) => {
  const eventId = parseInt(req.params.id);
  const rsvp = await prisma.rSVP.findUnique({ where: { eventId_userId: { eventId, userId: req.user!.id } } });
  if (!rsvp) return res.status(404).json({ error: 'Not found' });
  await prisma.rSVP.delete({ where: { id: rsvp.id } });
  if (rsvp.status === 'CONFIRMED') {
    const next = await prisma.rSVP.findFirst({ where: { eventId, status: 'WAITLISTED' }, orderBy: { createdAt: 'asc' }, include: { user: true, event: true } });
    if (next) {
      await prisma.rSVP.update({ where: { id: next.id }, data: { status: 'CONFIRMED' } });
      Notifier.send(next.user.email, `Promoted from waitlist for ${next.event.title}`);
    }
  }
  res.status(204).send();
});

export default app;