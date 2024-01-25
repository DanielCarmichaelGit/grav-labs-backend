const mongoose = require("mongoose");

const clientInvitationSchema = new mongoose.Schema({
  invitation_id: { type: String, required: true },
  associated_org: { type: Object, required: true },
  status: { type: String, required: true },
  client_email: { type: String, required: true },
  invite_url: { type: String, required: true },
});

module.exports = mongoose.model("ClientInvitation", clientInvitationSchema);
