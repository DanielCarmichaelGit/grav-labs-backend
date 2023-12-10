const mongoose = require("mongoose");

const userConfigSchema = new mongoose.Schema({
  email: { type: String, required: true },
  full_name: { type: String, required: true },
  configs: { type: Object, required: true },
  payment: { type: Object, required: true },
  association_id: { type: String, require: true },
  group_association: { type: String, require: true },
  associated_collection: { type: String, require: true },
});

module.exports = mongoose.model("UserConfig", userConfigSchema);
