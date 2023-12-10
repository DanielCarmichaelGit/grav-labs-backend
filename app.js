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
  
    const { title, time_limit, jam_url = "", options = "{}", image_url = "" } = req.body;
    const jam_id = uuidv4();
    console.log("yes");
    const new_jam = new Jam({
      title,
      time_limit,
      created_timestamp: Date.now(),
      jam_url,
      options,
      image_url,
      jam_id: jam_id,
      _id: jam_id
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

// Add a DELETE endpoint for deleting a jam by custom id
app.delete("/jams", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ message: "Please provide an 'id' parameter to delete a jam" });
    }

    // Attempt to find and delete the jam by custom id
    const deletedJam = await Jam.findOneAndDelete({ id });

    if (!deletedJam) {
      return res.status(404).json({ message: "Jam not found" });
    }

    return res.status(200).json({ message: "Jam deleted successfully", deletedJam });
  } catch (error) {
    console.error("There was an error deleting the jam:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


// Add a PUT endpoint for updating a jam by ID
app.put("/jams", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { id } = req.params;
    const { title, time_limit, jam_url = "", options = "{}", image_url = "" } = req.body;

    // Attempt to find and update the jam by ID
    const updatedJam = await Jam.findByIdAndUpdate(
      id,
      { title, time_limit, jam_url, options, image_url },
      { new: true } // Return the updated document
    );

    if (!updatedJam) {
      return res.status(404).json({ message: "Jam not found" });
    }

    return res.status(200).json({ message: "Jam updated successfully", updatedJam });
  } catch (error) {
    console.error("There was an error updating the jam:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});



const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});