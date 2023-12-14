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
  user_id: {
    type: String,
    required: true,
  },
  jam_groups: {
    type: Array,
    required: false,
  },
  jam_tasks: {
    type: Array,
    required: true,
  },
  jam_notes: {
    type: Array,
    required: true,
  },
  _id: {
    type: String,
    required: true,
  },
});

module.exports = mongoose.model("User", userSchema);
