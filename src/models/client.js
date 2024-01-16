const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema({
  client_id: { type: String, required: true },
  associated_org: { type: Object, required: true },
  client_users: { type: Array, required: true },
  client_poc: { type: Object, required: true },
  org_poc: { type: Object, required: true },
  client_name: { type: String, required: true },
});

module.exports = mongoose.model("Client", clientSchema);
