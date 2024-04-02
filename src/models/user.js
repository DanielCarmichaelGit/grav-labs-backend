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
  hosted_page: {
    type: Object,
    required: false
  },
  brand_colors: {
    type: Object,
    required: false
  },
  brand_industry: {
    type: String,
    required: false,
  },
  brand_copy: {
    type: String,
    required: false
  },
  brand_name: {
    type: String,
    required: false
  },
  brand_logo_url: {
    type: String,
    required: false
  },
  brand_images: {
    type: Array,
    required: false
  }
});

module.exports = mongoose.model("User", userSchema);
