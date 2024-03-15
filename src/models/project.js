const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema({
  project_id: { type: String, required: true },
  tasks: { type: Array, required: true },
  title: { type: String, required: true },
  organization: { type: String, required: true },
  status: { type: Object, required: true },
  client: { type: Object, required: false },
  total_time: { type: Number, required: true },
  hourly_cost: { type: Number, required: true },
  cost: { type: Object, required: true },
  description: { type: String, required: false },
});

module.exports = mongoose.model("Project", projectSchema);
