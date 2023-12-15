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
const JamGroup = require("./src/models/jamGroup");

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

//###########################################################################
// Add a POST endpoint for user registration (signup)
app.post("/signup", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
    const { username, password } = req.body; // Add jam_group
    const new_user_id = uuidv4();
    const new_jam_id = uuidv4();

    // Check if the username already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ message: "Username already exists" });
    }

    // Hash the password before saving it
    const hashedPassword = await bcrypt.hash(password, 10);

    const newGroup = new JamGroup({
      title: `${username}'s Jam`,
      users: [new_user_id],
      host_id: new_user_id,
      created_timestamp: Date.now(),
      jam_group_id: new_jam_id,
      join_code: "",
      _id: new_jam_id,
    });

    //Create a jam group for this new user
    const newUser = new User({
      username,
      password: hashedPassword,
      user_id: new_user_id,
      jam_groups: [new_jam_id], // Assign jam_group to the user
      jam_tasks: [],
      jam_notes: [],
      _id: new_user_id,
    });

    await newUser.save();
    await newGroup.save();

    const token = jwt.sign(
      { userId: new_user_id, jamGroup: new_jam_id },
      SECRET_JWT,
      {
        expiresIn: "12h",
      }
    );

    res.status(200).json({
      message: "User Registered",
      user: newUser,
      user_group: newGroup,
      token,
    });
  } catch (error) {
    console.error("Error during user registration:", error);
    res.status(500).json({ message: "Internal server error", error });
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

    // Create a JWT token with user ID and jam_group
    const token = jwt.sign(
      { userId: user._id, jamGroup: user.jam_group },
      SECRET_JWT,
      {
        expiresIn: "12h",
      }
    );

    res.status(201).json({
      message: "Login successful",
      token,
      user_id: user.uuid,
      jam_group: user.jam_group,
    });
  } catch (error) {
    console.error("Error during user login:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/jam_groups", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { title, users, host_id, join_code = "" } = req.body;

    const created_timestamp = Date.now();
    const jam_group_id = uuidv4();

    const newJamGroup = new JamGroup({
      title,
      users: [...users, host_id],
      host_id,
      created_timestamp,
      jam_group_id,
      join_code,
      jam_notes: [],
      _id: jam_group_id,
    });

    await User.findByIdAndUpdate(
      host_id,
      {
        $push: { jam_groups: jam_group_id },
      },
      { new: true }
    );

    await newJamGroup.save();
    res
      .status(201)
      .json({ message: "Jam Group Created", jamGroup: newJamGroup });
  } catch (error) {
    console.error("There was an error creating the Jam Group:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.put("/jam_groups/:id", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { id } = req.params;
    const {
      title,
      users,
      host_id,
      jam_notes,
      join_code,
      jam_id,
      subscribe = true,
    } = req.body;

    // Find the existing Jam Group by ID
    const existingJamGroup = await JamGroup.findById(id);

    if (!existingJamGroup) {
      return res.status(404).json({ message: "Jam Group not found" });
    }

    // Update the Jam Group fields based on the request body
    if (title !== undefined) existingJamGroup.title = title;

    if (subscribe === false) {
      // Remove the user's ID from the users array
      existingJamGroup.users = existingJamGroup.users.filter(
        (userId) => userId !== host_id
      );
    } else if (users !== undefined) {
      // Use $addToSet to add unique values to the existing array
      existingJamGroup.users = [
        ...new Set([...existingJamGroup.users, ...users]),
      ];
    }

    if (host_id !== undefined) existingJamGroup.host_id = host_id;
    if (jam_notes !== undefined) {
      existingJamGroup.jam_notes = [
        ...existingJamGroup.jam_notes,
        ...jam_notes,
      ];
    }
    if (join_code !== undefined) existingJamGroup.join_code = join_code;
    if (jam_id !== undefined) {
      existingJamGroup.jam_id = [
        ...new Set([...existingJamGroup.jam_id, ...jam_id]),
      ];
    }

    // Save the updated Jam Group
    const updatedJamGroup = await existingJamGroup.save();

    return res
      .status(200)
      .json({ message: "Jam Group updated successfully", updatedJamGroup });
  } catch (error) {
    console.error("There was an error updating the Jam Group:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.delete("/jam_groups/:id", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { id } = req.params;

    // Attempt to find and delete the Jam Group by ID
    const deletedJamGroup = await JamGroup.findOneAndDelete({ _id: id });

    if (!deletedJamGroup) {
      return res.status(404).json({ message: "Jam Group not found" });
    }

    return res
      .status(200)
      .json({ message: "Jam Group deleted successfully", deletedJamGroup });
  } catch (error) {
    console.error("There was an error deleting the Jam Group:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/join_group/:id", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { id } = req.params;
    const { join_code, user_id } = req.body;

    // Find the existing JamGroup by ID
    const existingGroup = await JamGroup.findById(id);

    if (!existingGroup) {
      return res.status(404).json({
        message: `Jam Group with id "${id}" does not exist or cannot be found`,
      });
    }

    if (join_code !== undefined && existingGroup.join_code === join_code) {
      // Update the JamGroup to add the current user to the users array
      existingGroup.users.push(user_id);
      await existingGroup.save();

      // Update the User to add the new jam_group to their jam_groups array
      await User.findByIdAndUpdate(user_id, { $push: { jam_groups: id } });

      return res
        .status(200)
        .json({ message: "User joined the group successfully" });
    } else {
      return res
        .status(400)
        .json({
          message: "Invalid join code",
          group_code: existingGroup.join_code,
          supplied_code: `code: "${join_code}" | user: "${user_id}"`,
        });
    }
  } catch (error) {
    console.error(
      "There was an error subscribing the user to the group: ",
      error
    );
    res.status(500).json({ message: "Failed to Subscribe User" });
  }
});

app.post("/create_jam", authenticateJWT, async (req, res) => {
  try {
    console.log("trying to connect");
    dbConnect(process.env.GEN_AUTH);
    console.log("db connected");

    const {
      title,
      time_limit,
      jam_url = "",
      options = "{}",
      image_url = "",
      jam_group_id,
      jam_tasks = [],
      jam_notes = [],
    } = req.body;

    console.log("reqessst", req.body);

    const existing_group = JamGroup.findById({ _id: jam_group_id });
    const created_timestamp = Date.now();

    if (!existing_group) {
      res.status(400).json({
        message: "Jam Group not found",
      });
    } else {
      console.log("about to create jam")
      const jam_id = uuidv4();
      const new_jam = new Jam({
        title,
        time_limit,
        created_timestamp,
        jam_url: jam_url,
        options: options,
        image_url: image_url,
        jam_id,
        jam_group_id,
        jam_group: existing_group,
        jam_tasks,
        jam_notes,
        _id: jam_id,
      });

      console.log("new jam", new_jam)

      await new_jam.save();
      console.log("jam saved")
      res.status(200).json({ message: "Jam Created", jam: new_jam });
    }
  } catch (error) {
    console.log("there was an error creating the authentication");
    res.status(500).json({ message: error.message, full_error: error });
  }
});

app.get("/jams/:group_id?", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
    const { group_id } = req.params;
    const { user_id } = req.body;

    if (group_id !== undefined && user_id !== undefined) {
      const existing_user = User.findById({ _id: user_id });

      if (existing_user.jam_groups.includes(group_id)) {
        const jam_group = JamGroup.findById({ _id: group_id });

        const jam_ids = jam_group.jam_id;

        const related_jams = await Jam.find({ _id: { $in: jam_ids } });

        res.status(201).json({
          message: "Jams found",
          count: related_jams.length,
          jams: related_jams,
        });
      } else {
        res
          .status(500)
          .json({ message: "User does not have access to this jam" });
      }
    } else if (group_id === undefined && user_id !== undefined) {
      const existing_user = User.findById({ _id: user_id });
      const user_groups = existing_user.jam_groups;

      const user_jams = await Jam.find({ jam_group_id: { $in: user_groups } });
      res.status(201).json({
        message: "Jams Found",
        count: user_jams.length,
        jams: user_jams,
      });
    } else {
      res
        .status(400)
        .json({ message: "No user id supplied. User id required" });
    }
  } catch (error) {
    console.error("There was an error retrieving jams:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

//###########################################################################

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

// Modify the GET endpoint for getting jam notes by user ID
app.get("/jam_notes/user/:user_id", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { user_id } = req.params;
    const userJamGroup = req.user.jam_group_id; // Get the user's jam_group

    // Find all JamNotes associated with the provided user_id and in the user's jam_group
    const jamNotes = await JamNote.find({ user_id, jam_group: userJamGroup });

    res
      .status(200)
      .json({ message: "JamNotes retrieved successfully", jamNotes });
  } catch (error) {
    console.error("There was an error retrieving JamNotes:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Add a GET endpoint to get all JamNotes associated with a jam_id
app.get("/jam_notes/jam/:jam_id", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { jam_id } = req.params;

    // Find all JamNotes associated with the provided jam_id
    const jamNotes = await JamNote.find({ jam_id });

    res
      .status(200)
      .json({ message: "JamNotes retrieved successfully", jamNotes });
  } catch (error) {
    console.error("There was an error retrieving JamNotes:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

//#######################//#######################//#######################//#######################
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
//#######################//#######################//#######################//#######################

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
