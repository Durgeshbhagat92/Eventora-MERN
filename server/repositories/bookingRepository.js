const Booking = require('../models/Booking');

class BookingRepository {
    async create(data) {
        return Booking.create(data);
    }

    async findById(id, options = {}) {
        let query = Booking.findById(id);

        if (options.populateUser) {
            query = query.populate('userId', options.userSelect);
        }

        if (options.populateEvent) {
            query = query.populate('eventId', options.eventSelect);
        }

        return query;
    }

    async findByUserAndEvent(userId, eventId) {
        return Booking.findOne({ userId, eventId });
    }

    async findForUser(userId) {
        return Booking.find({ userId })
            .populate('eventId')
            .sort({ createdAt: -1 });
    }

    async findAll() {
        return Booking.find()
            .populate('eventId')
            .populate('userId', 'name email')
            .sort({ createdAt: -1 });
    }

    async updateStatus(id, status, paymentStatus) {
        const update = { status };
        if (paymentStatus) update.paymentStatus = paymentStatus;

        return Booking.findByIdAndUpdate(id, update, { new: true });
    }

    async cancel(id) {
        return Booking.findByIdAndUpdate(
            id,
            { status: 'cancelled' },
            { new: true }
        );
    }
}

module.exports = new BookingRepository();