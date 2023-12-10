const mongoose = require("mongoose");

const jamNoteSchema = new mongoose.Schema({
  note: { type: String, required: true },
  jam_id: { type: String, required: true },
  user_id: { type: String, required: true },
  created_timestamp: { type: String, required: true },
  jam_group_id: { type: String, required: true },
  _id: { type: String, require: true },
});

module.exports = mongoose.model("JamNote", jamNoteSchema);
