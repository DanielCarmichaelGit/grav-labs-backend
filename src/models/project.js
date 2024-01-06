const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema({
  project_id: { type: String, required: true },
  tasks: {type: Array, required: true },
  title: {type: String, required: true},
  owner: {type: Object, required: true},
  owner_id: { type: String, required: true },
  members: {type: Array, required: true},
  viewers: {type: Array, required: false},
  status: {type: Object, required: true},
  start_date_time: {type: String, required: true},
  end_date_time: {type: String, required: true},
  kpi_data: {type: Object, required: true},
  cost: {type: Object, required: true}
});

module.exports = mongoose.model("Project", projectSchema);
