const express = require("express");
const cors = require("cors");
const dbConnect = require("./src/utils/dbConnect");
const { v4: uuidv4 } = require("uuid");
const Jam = require("./src/models/jam");

const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.options("*", cors()); // Enable CORS pre-flight request for all routes
app.use(express.json());

app.get("/", (req, res) => {
  console.log("received home");
  return res.status(200).json({ message: "working" });
});

// this endpoint uses the "auth" auth
app.post("/create_jam", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
  
    const { title, time_limit, jam_url, options = {} } = req.body;
    const jam_id = uuidv4();
    console.log("yes");
    const new_jam = new Jam({
      title,
      time_limit,
      created_timestamp: Date.now(),
      jam_url,
      options,
      jam_id: jam_id,
    });
  
    await new_jam.save();
    res.status(200).json({ message: "Jam Created" });
  }
  catch (error) {
    console.log("there was an error creating the authentication");
    res.status(500).json({ message: error.message });
  }
});

// Add a new GET endpoint for retrieving jams
app.get("/jams", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { id } = req.query;

    if (id) {
      // If an 'id' parameter is provided, get the specific jam by ID
      const jam = await Jam.findById(id);
      if (!jam) {
        return res.status(404).json({ message: "Jam not found" });
      }
      return res.status(200).json(jam);
    } else {
      // If no 'id' parameter is provided, get all jams
      const jams = await Jam.find();
      return res.status(200).json(jams);
    }
  } catch (error) {
    console.error("There was an error retrieving jams:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});