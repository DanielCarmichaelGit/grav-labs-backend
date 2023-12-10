// src/models/user.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  uuid: {
    type: String,
    required: true,
  },
  jam_groups: {
    type: Array,
    required: false,
  },
});

module.exports = mongoose.model("User", userSchema);
