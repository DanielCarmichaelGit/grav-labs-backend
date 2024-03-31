// src/models/user.js
const mongoose = require("mongoose");

const landingPageSchema = new mongoose.Schema({
  page_id: {
    type: String,
    required: true,
  },
  title: {
    type: Object,
    required: true
  },
  user: {
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
  }
});

module.exports = mongoose.model("LandingPage", landingPageSchema);
