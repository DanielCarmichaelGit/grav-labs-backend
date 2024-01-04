const mongoose = require("mongoose");

const organizationSchema = new mongoose.Schema({
  org_id: { type: String, required: true },
  name: { type: String, required: true },
  members: { type: Array, required: true },
  admins: { type: Array, required: true },
  seats: { type: Number, required: true },
  status: { type: String, required: true },
  billable_user: { type: Object, required: true },
  billing: { type: Object, required: true },
  sprints: {type: Array, required: true}
});

module.exports = mongoose.model("Organization", organizationSchema);
