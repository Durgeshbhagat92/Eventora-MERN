import "dotenv/config";
import bcrypt from "bcryptjs";
import { MongoConnection, EventRepository, UserRepository, BookingRepository } from "./repositories";

const seed = async () => {
  const db = await MongoConnection.connect(
    process.env.MONGO_URI ?? "mongodb://localhost:27017/eventora",
    process.env.MONGO_DB ?? "eventora",
  );
  const users = new UserRepository(db);
  const events = new EventRepository(db);
  const bookings = new BookingRepository(db);

  await Promise.all([
    db.collection("users").deleteMany({}),
    db.collection("events").deleteMany({}),
    db.collection("bookings").deleteMany({}),
  ]);

  const password = await bcrypt.hash("password123", 10);
  const admin = await users.create({
    name: "Admin User",
    email: "admin@eventora.com",
    password,
    role: "admin",
    isVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const user = await users.create({
    name: "Demo User",
    email: "user@eventora.com",
    password,
    role: "user",
    isVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const event = await events.create({
    title: "React & Node.js Developer Retreat",
    description: "A practical full-stack development meetup.",
    date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    location: "Silicon Valley Innovation Center, CA",
    category: "Technology",
    totalSeats: 200,
    availableSeats: 199,
    ticketPrice: 0,
    image: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&q=80&w=800",
    createdBy: admin._id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await bookings.insertOne({
    userId: user._id,
    eventId: event._id,
    status: "confirmed",
    paymentStatus: "paid",
    amount: 0,
    bookedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log("Database seeded successfully.");
  console.log("Admin: admin@eventora.com / password123");
  console.log("User:  user@eventora.com / password123");
  await MongoConnection.disconnect();
};

seed().catch(async (error) => {
  console.error("Error seeding data:", error);
  await MongoConnection.disconnect();
  process.exitCode = 1;
});