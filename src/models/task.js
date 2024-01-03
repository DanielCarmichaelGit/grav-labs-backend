const mongoose = require("mongoose");

const organizationSchema = new mongoose.Schema({
  title: {type: String, required: true},
  assigned_by: {type: Object, required: true},
  assignees: {type: Object, required: true},
  client: {type: Object, required: false},
  status: {type: Object, required: true},
  start_time: {type: String, required: true},
  duration: {type: Number, required: true},
  hard_limit: {type: Boolean, required: true},
  requires_authorization: {type: Boolean, required: true},
  authorized_by: {type: Boolean, required: false}
});

module.exports = mongoose.model("Organization", organizationSchema);
