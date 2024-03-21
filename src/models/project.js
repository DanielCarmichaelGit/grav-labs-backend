const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema({
  project_id: { type: String, required: true },
  title: { type: String, required: true },
  organization: { type: Object, required: true },
  status: { type: Object, required: true },
  client: { type: Object, required: false },
  total_time: { type: Number, required: true },
  cost: { type: Number, required: true },
  description: { type: String, required: false },
  budget: { type: Number, required: true },
  invoices: { type: Array, required: false }
});

module.exports = mongoose.model("Project", projectSchema);
