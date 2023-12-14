const mongoose = require("mongoose");

const jamGroupSchema = new mongoose.Schema({
  title: { type: String, required: true },
  users: { type: Array, required: true },
  host_id: { type: String, required: true },
  created_timestamp: { type: String, required: true },
  jam_group_id: { type: String, required: true },
  join_code: { type: String, required: false},
  _id: { type: String, require: true },
});

module.exports = mongoose.model("JamGroup", jamGroupSchema);
