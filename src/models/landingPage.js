// src/models/user.js
const mongoose = require("mongoose");

const landingPageSchema = new mongoose.Schema({
  page_id: {
    type: String,
    required: true,
  },
  user_id: {
    type: String,
    required: true,
  },
  history_id: {
    type: String,
    required: true,
  },
  timestamp: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    required: true
  }
});

module.exports = mongoose.model("LandingPage", landingPageSchema);
