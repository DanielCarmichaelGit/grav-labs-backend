const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema({
  task_id: { type: String, required: true },
  title: { type: String, required: true },
  assigned_by: { type: Object, required: true },
  assignees: { type: Array, required: true },
  client: { type: Object, required: false },
  status: { type: Object, required: true },
  escalation: { type: String, required: true },
  start_time: { type: String, required: true },
  duration: { type: Number, required: true },
  hard_limit: { type: Boolean, required: true },
  requires_authorization: { type: Boolean, required: true },
  authorized_by: { type: Boolean, required: false },
  completed_on: {type: String, required: false},
});

module.exports = mongoose.model("Task", taskSchema);
