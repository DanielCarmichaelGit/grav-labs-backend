const mongoose = require("mongoose");

const alertSchema = new mongoose.Schema({
  alert_id: { type: String, required: true },
  to_user: { type: Object, required: true },
  created_by: { type: Object, required: true },
  text: { type: String, required: true },
  task: { type: Object, required: false },
  timestamp: { type: Object, required: true },
  escalation: { type: String, required: true },
});

module.exports = mongoose.model("Alert", alertSchema);
