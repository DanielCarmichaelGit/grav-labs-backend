const mongoose = require("mongoose");

const sprintSchema = new mongoose.Schema({
  sprint_id: { type: String, required: true },
  title: { type: String, required: true },
  owner: { type: Object, required: true },
  members: { type: Array, required: true },
  viewers: { type: Object, required: false },
  status: { type: String, required: true },
  start_date_time: { type: String, required: true },
  duration: { type: Number, required: true },
  kpi_data: { type: Object, required: true },
  organization: { type: Object, required: true },
  objective: { type: String, required: true },
  is_started: { type: Boolean, required: true },
  tasks: { type: Array, required: true },
});

module.exports = mongoose.model("Sprint", sprintSchema);
