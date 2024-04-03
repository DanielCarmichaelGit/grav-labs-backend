// src/models/user.js
const mongoose = require("mongoose");

const variantSchema = new mongoose.Schema({
  variant_id: {
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
  },
  messages: {
    type: Array,
    required: true
  }
});

module.exports = mongoose.model("Variant", variantSchema);
