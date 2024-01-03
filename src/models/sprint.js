const mongoose = require("mongoose");

const sprintSchema = new mongoose.Schema({
  title: {type: String, required: true},
  owner: {type: Object, required: true},
  members: {type: Array, required: true},
  viewers: {type: Object, required: false},
  status: {type: Object, required: true},
  start_date_time: {type: String, required: true},
  duration: {type: Number, required: true},
  kpi_data: {type: Object, required: true},
});

module.exports = mongoose.model("Sprint", sprintSchema);
