const mongoose = require("mongoose");

const jamSchema = new mongoose.Schema({
  title: { type: String, required: true },
  time_limit: { type: Number, required: true },
  created_timestamp: { type: String, required: true },
  jam_url: { type: String, required: false},
  options: { type: String, required: false},
  image_url: { type: String, required: false},
  _id: {type: String, require: true}
});

module.exports = mongoose.model("Jam", jamSchema);
