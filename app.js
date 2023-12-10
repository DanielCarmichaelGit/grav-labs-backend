const express = require("express");
const cors = require("cors");
const dbConnect = require("./src/utils/dbConnect");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// Secret key for JWT signing (change it to a strong, random value)
const SECRET_JWT = process.env.SECRET_JWT;

const User = require("./src/models/user");
const Jam = require("./src/models/jam");
const JamNote = require("./src/models/jamNote");

const app = express();
app.use(cors());
app.options("*", cors()); // Enable CORS pre-flight request for all routes
app.use(express.json());

// Middleware to verify JWT token
function authenticateJWT(req, res, next) {
  const token = req.header("Authorization");

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  jwt.verify(token, SECRET_JWT, (error, user) => {
    if (error) {
      return res.status(403).json({ message: "Token is invalid" });
    }

    req.user = user;
    next();
  });
}

app.get("/", (req, res) => {
  console.log("received home");
  return res.status(200).json({ message: "working" });
});

// this endpoint uses the "auth" auth
app.post("/create_jam", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const {
      title,
      time_limit,
      jam_url = "",
      options = "{}",
      image_url = "",
    } = req.body;
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
      _id: jam_id,
    });

    await new_jam.save();
    res.status(200).json({ message: "Jam Created", jam: new_jam });
  } catch (error) {
    console.log("there was an error creating the authentication");
    res.status(500).json({ message: error.message });
  }
});

// Add a POST endpoint for creating a JamNote
app.post("/jam_note", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { note, jam_id } = req.body;
    const user_id = req.user.userId; // Extract the user ID from the JWT payload
    const created_timestamp = Date.now();
    const jam_note_id = uuidv4();

    const new_jam_note = new JamNote({
      note,
      jam_id,
      user_id,
      created_timestamp,
      _id: jam_note_id,
    });

    await new_jam_note.save();
    res
      .status(201)
      .json({ message: "JamNote Created", jam_note: new_jam_note });
  } catch (error) {
    console.error("There was an error creating the JamNote:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Add a POST endpoint for user registration (signup)
app.post("/signup", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
    const { username, password } = req.body;
    const uuid = uuidv4();

    // Check if the username already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: "Username already exists" });
    }

    // Hash the password before saving it
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      username,
      password: hashedPassword,
      uuid
    });

    await newUser.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Error during user registration:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Add a POST endpoint for user login
app.post("/login", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    // Create a JWT token
    const token = jwt.sign({ userId: user._id }, SECRET_JWT, {
      expiresIn: "1h",
    });

    res.status(200).json({ message: "Login successful", token });
  } catch (error) {
    console.error("Error during user login:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Add a new GET endpoint for retrieving jams
app.get("/jams", authenticateJWT, async (req, res) => {
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
app.delete("/jams", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { id } = req.query;

    if (!id) {
      return res
        .status(400)
        .json({ message: "Please provide an 'id' parameter to delete a jam" });
    }

    // Attempt to find and delete the jam by custom id
    const deletedJam = await Jam.findOneAndDelete({ _id: id });

    if (!deletedJam) {
      return res.status(404).json({ message: "Jam not found" });
    }

    return res
      .status(200)
      .json({ message: "Jam deleted successfully", deletedJam });
  } catch (error) {
    console.error("There was an error deleting the jam:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Add a PUT endpoint for updating a jam by ID
app.put("/jams/:id", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { id } = req.params;
    const {
      title,
      time_limit,
      jam_url = "",
      options = "{}",
      image_url = "",
    } = req.body;

    // Attempt to find and update the jam by ID
    const updatedJam = await Jam.findByIdAndUpdate(
      id,
      { title, time_limit, jam_url, options, image_url },
      { new: true } // Return the updated document
    );

    if (!updatedJam) {
      return res.status(404).json({ message: "Jam not found" });
    }

    return res
      .status(200)
      .json({ message: "Jam updated successfully", updatedJam });
  } catch (error) {
    console.error("There was an error updating the jam:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
