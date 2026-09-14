import "dotenv/config";
import path from "node:path";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { ObjectId, WithId } from "mongodb";
import {
  Booking,
  BookingRepository,
  EventDoc,
  EventRepository,
  MongoConnection,
  OtpRepository,
  User,
  UserRepository,
  toObjectId,
} from "./repositories";

const app = express();
const port = Number(process.env.PORT ?? 5000);
const jwtSecret = process.env.JWT_SECRET ?? "development-secret";

app.use(cors());
app.use(express.json());

type AuthRequest = Request & { user?: WithId<User> };
let users: UserRepository;
let events: EventRepository;
let bookings: BookingRepository;
let otps: OtpRepository;

const publicUser = (user: WithId<User>) => ({
  _id: user._id.toHexString(),
  name: user.name,
  email: user.email,
  role: user.role,
});

const tokenFor = (user: WithId<User>) => jwt.sign(
  { id: user._id.toHexString(), role: user.role },
  jwtSecret,
  { expiresIn: "30d" }
);

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendOtpEmail = async (email: string, otp: string, type: string) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: type === "account_verification" ? "Verify your Eventora Account" : "Eventora Booking Verification",
    text: `Your Eventora verification code is ${otp}. It expires in 5 minutes.`,
  });
};

const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Not authorized, no token" });
    return;
  }

  try {
    const decoded = jwt.verify(header.split(" ")[1], jwtSecret) as { id: string };
    const user = await users.findById(decoded.id);
    if (!user) {
      res.status(401).json({ message: "Not authorized, user not found" });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: "Not authorized, token failed" });
  }
};

const admin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== "admin") {
    res.status(403).json({ message: "Not authorized as an admin" });
    return;
  }
  next();
};

const handle = (handler: (req: AuthRequest, res: Response) => Promise<void>) => (
  req: Request,
  res: Response,
  next: NextFunction,
) => handler(req as AuthRequest, res).catch(next);

app.post("/api/auth/register", handle(async (req, res) => {
  const { name, email, password } = req.body as { name: string; email: string; password: string };
  if (await users.findByEmail(email)) {
    res.status(400).json({ message: "User already exists" });
    return;
  }
  const user = await users.create({
    name,
    email: email.toLowerCase(),
    password: await bcrypt.hash(password, 10),
    role: "user",
    isVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const otp = generateOtp();
  await otps.replace(user.email, "account_verification", otp);
  await sendOtpEmail(user.email, otp, "account_verification");
  res.status(201).json({ message: "OTP sent to email. Please verify.", email: user.email });
}));

app.post("/api/auth/login", handle(async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const user = await users.findByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(400).json({ message: "Invalid credentials" });
    return;
  }
  if (!user.isVerified && user.role !== "admin") {
    const otp = generateOtp();
    await otps.replace(user.email, "account_verification", otp);
    await sendOtpEmail(user.email, otp, "account_verification");
    res.status(403).json({ message: "Account not verified", needsVerification: true, email: user.email });
    return;
  }
  res.json({ ...publicUser(user), token: tokenFor(user) });
}));

app.post("/api/auth/verify-otp", handle(async (req, res) => {
  const { email, otp } = req.body as { email: string; otp: string };
  const valid = await otps.findOne({ email, otp, action: "account_verification" });
  if (!valid) {
    res.status(400).json({ message: "Invalid or expired OTP" });
    return;
  }
  const user = await users.markVerified(email);
  await otps.deleteById(valid._id);
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  res.json({ ...publicUser(user), token: tokenFor(user) });
}));

app.get("/api/events", handle(async (req, res) => {
  const result = await events.search(req.query.category as string | undefined, req.query.search as string | undefined);
  res.json(result);
}));

app.get("/api/events/:id", handle(async (req, res) => {
  const event = await events.findById(req.params.id as string);
  if (!event) {
    res.status(404).json({ message: "Event not found" });
    return;
  }
  res.json(event);
}));

app.post("/api/events", protect, admin, handle(async (req, res) => {
  const body = req.body as Omit<EventDoc, "_id" | "createdBy" | "createdAt" | "updatedAt" | "availableSeats"> & { totalSeats: number };
  const event = await events.create({
    ...body,
    date: new Date(body.date),
    availableSeats: body.totalSeats,
    ticketPrice: body.ticketPrice ?? 0,
    image: body.image ?? "",
    createdBy: req.user!._id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  res.status(201).json(event);
}));

app.put("/api/events/:id", protect, admin, handle(async (req, res) => {
  const id = toObjectId(req.params.id as string);
  if (!(await events.findById(id))) {
    res.status(404).json({ message: "Event not found" });
    return;
  }
  await events.updateById(id, { $set: { ...req.body, updatedAt: new Date() } } as any);
  res.json(await events.findById(id));
}));

app.delete("/api/events/:id", protect, admin, handle(async (req, res) => {
  if (!(await events.deleteById(req.params.id as string))) {
    res.status(404).json({ message: "Event not found" });
    return;
  }
  res.json({ message: "Event deleted successfully" });
}));

app.post("/api/bookings/send-otp", protect, handle(async (req, res) => {
  const otp = generateOtp();
  await otps.replace(req.user!.email, "event_booking", otp);
  await sendOtpEmail(req.user!.email, otp, "event_booking");
  res.json({ message: "OTP sent successfully" });
}));

app.post("/api/bookings", protect, handle(async (req, res) => {
  const { eventId, otp } = req.body as { eventId: string; otp: string };
  const valid = await otps.findOne({ email: req.user!.email, otp, action: "event_booking" });
  if (!valid) {
    res.status(400).json({ message: "Invalid or expired OTP for booking" });
    return;
  }
  const event = await events.findById(eventId);
  if (!event || event.availableSeats <= 0) {
    res.status(400).json({ message: event ? "No seats available" : "Event not found" });
    return;
  }
  const existing = await bookings.findByUserAndEvent(req.user!._id, event._id);
  if (existing && existing.status !== "cancelled") {
    res.status(400).json({ message: "Already booked or pending" });
    return;
  }
  const booking = await bookings.insertOne({
    userId: req.user!._id,
    eventId: event._id,
    status: "pending",
    paymentStatus: "not_paid",
    amount: event.ticketPrice,
    bookedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await otps.deleteById(valid._id);
  res.status(201).json({ message: "Booking request submitted", booking });
}));

app.get("/api/bookings/my", protect, handle(async (req, res) => {
  const result = req.user!.role === "admin"
    ? await bookings.findMany({}, { sort: { createdAt: -1 } })
    : await bookings.findForUser(req.user!._id);
  res.json(result);
}));

app.put("/api/bookings/:id/confirm", protect, admin, handle(async (req, res) => {
  const booking = await bookings.findById(req.params.id as string);
  if (!booking) {
    res.status(404).json({ message: "Booking not found" });
    return;
  }
  if (booking.status === "confirmed") {
    res.status(400).json({ message: "Booking is already confirmed" });
    return;
  }
  const event = await events.findById(booking.eventId);
  if (!event || event.availableSeats <= 0) {
    res.status(400).json({ message: "No seats available to confirm this booking" });
    return;
  }
  await bookings.updateStatus(booking._id, "confirmed", req.body.paymentStatus);
  await events.updateById(event._id, { $inc: { availableSeats: -1 } } as any);
  res.json({ message: "Booking confirmed successfully", booking: { ...booking, status: "confirmed" } });
}));

app.delete("/api/bookings/:id", protect, handle(async (req, res) => {
  const booking = await bookings.findById(req.params.id as string);
  if (!booking) {
    res.status(404).json({ message: "Booking not found" });
    return;
  }
  if (booking.userId.toHexString() !== req.user!._id.toHexString() && req.user!.role !== "admin") {
    res.status(403).json({ message: "Not authorized" });
    return;
  }
  if (booking.status === "cancelled") {
    res.status(400).json({ message: "Already cancelled" });
    return;
  }
  await bookings.updateStatus(booking._id, "cancelled");
  if (booking.status === "confirmed") {
    await events.updateById(booking.eventId, { $inc: { availableSeats: 1 } } as any);
  }
  res.json({ message: "Booking cancelled successfully" });
}));

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ message: "Server Error", error: error.message });
});

async function main() {
  const db = await MongoConnection.connect(
    process.env.MONGO_URI ?? "mongodb://localhost:27017/eventora",
    process.env.MONGO_DB ?? "eventora",
  );
  users = new UserRepository(db);
  events = new EventRepository(db);
  bookings = new BookingRepository(db);
  otps = new OtpRepository(db);
  await Promise.all([users.ensureIndexes(), events.ensureIndexes(), bookings.ensureIndexes(), otps.ensureIndexes()]);
  app.listen(port, () => console.log(`Server running on port ${port}`));
}

main().catch((error) => {
  console.error("MongoDB connection error:", error);
  process.exit(1);
});