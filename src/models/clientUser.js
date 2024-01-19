// src/models/user.js
const mongoose = require("mongoose");

const clientUserSchema = new mongoose.Schema({
  client_user_id: {
    type: String,
    required: true,
  },
  client_name: {
    type: String,
    required: true
  },
  client_admin_email: {
    type: String,
    required: true,
  },
  client_admin_password: {
    type: String,
    required: true,
  },
  associated_org: {
    type: Object,
    required: true,
  },
  type: {
    type: String,
    required: true
  },
  marketable: {
    type: Boolean,
    required: true
  },
  client: {
    type: Object,
    required: true
  }
});

module.exports = mongoose.model("ClientUser", clientUserSchema);