// src/models/user.js
const mongoose = require("mongoose");

const pageHistorySchema = new mongoose.Schema({
  history_id: {
    type: String,
    required: true,
  },
  user_id: {
    type: String,
    required: true,
  },
  page_id: {
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

module.exports = mongoose.model("PageHistory", pageHistorySchema);
