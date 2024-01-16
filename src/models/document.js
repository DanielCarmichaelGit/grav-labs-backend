const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({
  document_id: { type: String, required: true },
  associated_org: { type: Object, required: true },
  contributors: { type: Array, required: true },
  client: { type: Object, required: true },
  updates: { type: Array, required: true },
  folder: { type: Object, required: true },
  document_name: { type: String, required: true },
  creator: { type: Object, required: true },
  content: { type: Array, required: true},
  created_timestamp: { type: String, required: true }
});

module.exports = mongoose.model("Document", documentSchema);
