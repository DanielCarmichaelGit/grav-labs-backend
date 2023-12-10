const mongoose = require("mongoose");

const jamNoteSchema = new mongoose.Schema({
  notes: { type: String, required: true },
  associated_id: { type: String, required: true },
  created_timestamp: { type: String, required: true },
  _id: {type: String, require: true}
});

module.exports = mongoose.model("JamNote", jamNoteSchema);
