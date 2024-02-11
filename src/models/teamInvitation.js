const mongoose = require("mongoose");

const teamInvitationSchema = new mongoose.Schema({
  invitation_id: { type: String, required: true },
  associated_org: { type: Object, required: true },
  status: { type: String, required: true },
  team_member_email: { type: String, required: true },
  invite_url: { type: String, required: true },
});

module.exports = mongoose.model("TeamInvitation", teamInvitationSchema);
