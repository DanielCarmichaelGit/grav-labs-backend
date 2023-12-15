const mongoose = require("mongoose");

const jamTaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  jam_id: { type: String, required: true },
  tasked_users: { type: Array, required: false },
  created_timestamp: { type: String, required: true },
  complete_by_timestamp: { type: String, required: false },
  completed_timestamp: { type: String, required: false },
  status: { type: String, required: false },
  _id: { type: String, require: true },
});

module.exports = mongoose.model("JamTask", jamTaskSchema);
