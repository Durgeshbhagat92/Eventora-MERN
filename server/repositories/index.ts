import {
  Collection,
  Db,
  Filter,
  FindOptions,
  MongoClient,
  ObjectId,
  OptionalUnlessRequiredId,
  UpdateFilter,
  WithId,
} from "mongodb";

export interface User {
  _id?: ObjectId;
  name: string;
  email: string;
  password: string;
  role: "user" | "admin";
  isVerified: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EventDoc {
  _id?: ObjectId;
  title: string;
  description: string;
  date: Date;
  location: string;
  category: string;
  totalSeats: number;
  availableSeats: number;
  ticketPrice: number;
  image: string;
  createdBy: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type BookingStatus = "pending" | "confirmed" | "cancelled";
export type PaymentStatus = "paid" | "not_paid";

export interface Booking {
  _id?: ObjectId;
  userId: ObjectId;
  eventId: ObjectId;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  amount: number;
  bookedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface Otp {
  _id?: ObjectId;
  email: string;
  otp: string;
  action: "account_verification" | "event_booking";
  createdAt: Date;
}

export class MongoConnection {
  private static client: MongoClient | null = null;
  private static db: Db | null = null;

  static async connect(uri: string, dbName: string): Promise<Db> {
    if (this.db) return this.db;
    this.client = new MongoClient(uri, { maxPoolSize: 20 });
    await this.client.connect();
    this.db = this.client.db(dbName);
    return this.db;
  }

  static async disconnect(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.db = null;
  }
}

export abstract class BaseRepository<T extends { _id?: ObjectId }> {
  protected readonly collection: Collection<T>;

  protected constructor(db: Db, collectionName: string) {
    this.collection = db.collection<T>(collectionName);
  }

  async insertOne(doc: OptionalUnlessRequiredId<T>): Promise<WithId<T>> {
    const result = await this.collection.insertOne(doc);
    return { ...doc, _id: result.insertedId } as WithId<T>;
  }

  async findById(id: string | ObjectId): Promise<WithId<T> | null> {
    return this.collection.findOne({ _id: toObjectId(id) } as Filter<T>);
  }

  async findOne(filter: Filter<T>): Promise<WithId<T> | null> {
    return this.collection.findOne(filter);
  }

  async findMany(filter: Filter<T>, options?: FindOptions<T>): Promise<WithId<T>[]> {
    return this.collection.find(filter, options).toArray();
  }

  async updateById(id: string | ObjectId, update: UpdateFilter<T>): Promise<boolean> {
    const result = await this.collection.updateOne({ _id: toObjectId(id) } as Filter<T>, update);
    return result.modifiedCount > 0;
  }

  async deleteById(id: string | ObjectId): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: toObjectId(id) } as Filter<T>);
    return result.deletedCount > 0;
  }
}

export class UserRepository extends BaseRepository<User> {
  constructor(db: Db) {
    super(db, "users");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ email: 1 }, { unique: true });
  }

  async findByEmail(email: string): Promise<WithId<User> | null> {
    return this.findOne({ email: email.toLowerCase() } as Filter<User>);
  }

  async create(data: Omit<User, "_id">): Promise<WithId<User>> {
    return this.insertOne(data);
  }

  async markVerified(email: string): Promise<WithId<User> | null> {
    await this.collection.updateOne({ email } as Filter<User>, { $set: { isVerified: true, updatedAt: new Date() } });
    return this.findByEmail(email);
  }
}

export class EventRepository extends BaseRepository<EventDoc> {
  constructor(db: Db) {
    super(db, "events");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ category: 1 });
    await this.collection.createIndex({ date: 1 });
  }

  async search(category?: string, search?: string): Promise<WithId<EventDoc>[]> {
    const filter: Filter<EventDoc> = {};
    if (category) filter.category = category;
    if (search) filter.title = { $regex: search, $options: "i" };
    return this.findMany(filter, { sort: { date: 1 } });
  }

  async create(data: Omit<EventDoc, "_id">): Promise<WithId<EventDoc>> {
    return this.insertOne(data);
  }
}

export class BookingRepository extends BaseRepository<Booking> {
  constructor(db: Db) {
    super(db, "bookings");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ userId: 1, createdAt: -1 });
    await this.collection.createIndex({ eventId: 1 });
  }

  async findByUserAndEvent(userId: string | ObjectId, eventId: string | ObjectId) {
    return this.findOne({ userId: toObjectId(userId), eventId: toObjectId(eventId) } as Filter<Booking>);
  }

  async findForUser(userId: string | ObjectId) {
    return this.findMany({ userId: toObjectId(userId) } as Filter<Booking>, { sort: { createdAt: -1 } });
  }

  async updateStatus(id: string | ObjectId, status: BookingStatus, paymentStatus?: PaymentStatus) {
    const set: Partial<Booking> = { status, updatedAt: new Date() };
    if (paymentStatus) set.paymentStatus = paymentStatus;
    return this.updateById(id, { $set: set } as UpdateFilter<Booking>);
  }
}

export class OtpRepository extends BaseRepository<Otp> {
  constructor(db: Db) {
    super(db, "otps");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 300 });
    await this.collection.createIndex({ email: 1, action: 1 });
  }

  async replace(email: string, action: Otp["action"], otp: string): Promise<WithId<Otp>> {
    await this.collection.deleteMany({ email, action } as Filter<Otp>);
    return this.insertOne({ email, otp, action, createdAt: new Date() });
  }
}

export function toObjectId(value: string | ObjectId): ObjectId {
  return typeof value === "string" ? new ObjectId(value) : value;
}