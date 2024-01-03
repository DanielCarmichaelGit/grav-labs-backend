// src/models/user.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  user_id: {
    type: String,
    required: true,
  },
  name: {
    type: Object,
    required: true
  },
  email: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: true,
  },
  organization: {
    type: Object,
    required: true,
  },
  kpi_data: {
    type: Object,
    required: true,
  },
  tasks: {
    type: Array,
    required: true,
  },
  type: {
    type: String,
    required: true
  },
  profile_image_url: {
    type: String,
    required: false,
  },
});

module.exports = mongoose.model("User", userSchema);
