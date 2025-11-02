// backend/models/eventModel.js
const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  start_ts: { type: Date, required: true },   // store as Date (UTC)
  end_ts: { type: Date, required: true },
  all_day: { type: Boolean, default: false },
  color: { type: String, default: '#1a73e8' },
  recurrence_rule: { type: String, default: null }, // optional RRULE string
  created_by: { type: String, default: null }, // optional user id/email
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// basic validation: end must be > start
EventSchema.pre('validate', function(next){
  if (this.start_ts && this.end_ts && this.end_ts <= this.start_ts) {
    return next(new Error('end_ts must be after start_ts'));
  }
  next();
});

module.exports = mongoose.model('Event', EventSchema);
