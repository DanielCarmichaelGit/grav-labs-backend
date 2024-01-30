const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({
  document_id: { type: String, required: true },
  associated_org: { type: Object, required: true },
  contributors: { type: Array, required: true },
  document_client: { type: Object, required: false },
  updates: { type: Array, required: true },
  document_folder: { type: Object, required: false },
  creator: { type: Object, required: true },
  content: { type: Object, required: true },
  blocks: { type: Array, required: true },
  last_block_timestamp: { type: String, required: true },
  last_block_version: { type: String, required: true },
  title: { type: String, required: true },
  created_timestamp: { type: String, required: true }
});

module.exports = mongoose.model("Document", documentSchema);
