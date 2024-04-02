// src/models/user.js
const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema({
  image_id: {
    type: String,
    required: true,
  },
  filename: {
    type: String,
    required: true,
  },
  contentType: {
    type: String,
    required: true
  },
  user_id: {
    type: String,
    required: true,
  },
  hosted__url: {
    type: String,
    required: false
  },
  copy: {
    type: String,
    required: true
  },
});

module.exports = mongoose.model("Image", imageSchema);
