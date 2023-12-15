const express = require("express");
const cors = require("cors");

// import utility functions
const dbConnect = require("./src/utils/dbConnect");
const generateUniqueUsername = require("./src/utils/generateUsername");

// import packages
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const sgTransport = require("nodemailer-sendgrid-transport");

// Secret key for JWT signing (change it to a strong, random value)
const SECRET_JWT = process.env.SECRET_JWT;

// import models
const User = require("./src/models/user");
const Jam = require("./src/models/jam");
const JamNote = require("./src/models/jamNote");
const JamGroup = require("./src/models/jamGroup");
const JamTask = require("./src/models/jamTasks");
const arrayDifference = require("./src/utils/findDiff");

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

// create utility transporter for email service
const transporter = nodemailer.createTransport(
  sgTransport({
    auth: {
      api_key: process.env.SG_API_KEY, // Replace with your SendGrid API key
    },
  })
);

// test endpoint to verify server status
app.get("/", (req, res) => {
  console.log("received home");
  return res.status(200).json({ message: "working" });
});

//###########################################################################
// Add a POST endpoint for user registration (signup)
app.post("/signup", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
    const { password, email } = req.body; // Add jam_group
    const new_user_id = uuidv4();
    const new_jam_id = uuidv4();
    const username = generateUniqueUsername();

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
      email,
      user_id: new_user_id,
      jam_groups: [new_jam_id], // Assign jam_group to the user
      jam_tasks: [],
      jam_notes: [],
      _id: new_user_id,
    });

    // save new user and the new group made for the user
    await newUser.save();
    await newGroup.save();

    // generate email content
    const mail_options = {
      from: "jammanager.io@gmail.com",
      to: email, // The user's email address
      subject: "Welcome to Jam Manager",
      html: `
      <html>
      <head>
        <style>
          /* Add inline styles here for your email */
          body {
            font-family: Arial, sans-serif;
            background-color: #f5f5f5;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            background-color: #007BFF;
            color: #ffffff;
            padding: 20px 0;
            border-radius: 10px 10px 0 0;
          }
          .header h1 {
            font-size: 24px;
            margin: 0;
          }
          .content {
            padding: 20px;
          }
          .content img {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 0 auto;
          }
          .button {
            text-align: center;
            margin-top: 20px;
          }
          .button a {
            display: inline-block;
            background-color: #007BFF;
            color: #ffffff;
            text-decoration: none;
            padding: 10px 20px;
            border-radius: 5px;
          }
          .unsubscribe {
            text-align: center;
            margin-top: 20px;
          }
          .unsubscribe a {
            color: #007BFF;
            text-decoration: none;
          }
          .footer {
            text-align: center;
            margin-top: 20px;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Jam Manager</h1>
          </div>
          <div class="content">
            <img src="https://jammanager.s3.us-east-2.amazonaws.com/DALL%C2%B7E+2023-12-15+01.44.30+-+Create+a+logo+for+'Jam+Manager'+without+any+text%2C+focusing+purely+on+visual+elements.+The+logo+should+feature+a+stylized%2C+colorful+jar+of+jam%2C+represe.png" alt="Jam Manager Logo">
            <div class="button">
              <a href="https://jam-manager.netlify.app/" style="background-color: #007BFF; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Visit Jam Manager</a>
            </div>
          </div>
          <div class="unsubscribe">
            <a href="#">Unsubscribe</a>
          </div>
          <div class="footer">
            <a href="#">Terms</a>
          </div>
        </div>
      </body>
      </html>
      `,
    };

    // call transporter to send email
    transporter.sendMail(mail_options, (error, info) => {
      if (error) {
        console.error("Email sending error:", error);
      } else {
        console.log("Email sent:", info);
      }
    });

    // sign the first token provided to the user
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
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Create a JWT token with user ID and jam_group
    const token = jwt.sign(
      { userId: user._id, jamGroup: user.jam_group },
      SECRET_JWT,
      {
        expiresIn: "12h",
      }
    );

    res.status(200).json({
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

// Add a PUT endpoint for updating the user associated with the JWT
app.put("/user", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const userId = req.user.userId; // Extract the user ID from the JWT payload
    const updatedFields = req.body;

    // Find the user by ID
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update only the fields provided in the request body
    for (const key in updatedFields) {
      if (key === "password" || key == email || key == user_id) {
        return res.status(500).json({
          message:
            "Cannot update email, password, or user_id via this endpoint.",
        });
      }
      if (updatedFields.hasOwnProperty(key)) {
        user[key] = updatedFields[key];
      }
    }

    // Save the updated user document
    const updatedUser = await user.save();

    return res
      .status(200)
      .json({ message: "User updated successfully", updatedUser });
  } catch (error) {
    console.error("There was an error updating the user:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/user/:expanded?", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    console.log("12345", req);

    const { user_id } = req.user.userId;
    const { expanded = "false" } = req.params;
    const user = User.findById({ _id: user_id });


    if (expanded === false) {
      return res.status(200).json({
        message: "User Found",
        user,
      });
    } else if (expanded === "true") {
      const user_groups = await JamGroup.findById({_id: { $in: user.jam_groups }});
      const jam_ids = user_groups.reduce((acc, group) => acc.concat(group.jam_id), []);
      const user_jams = await Jam.findById({ _id: { $in: jam_ids } });
      const compiled_user = {
        user_id,
        user_groups,
        jam_ids,
        user_jams,
        user
      };
      return res.status(200).json({
        message: "Compiled User",
        compiled_user
      })
    }
  } catch (error) {
    console.error("Could not fetch user", error);
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
      return res.status(400).json({
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
    dbConnect(process.env.GEN_AUTH);

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

    const existing_group = await JamGroup.findById({ _id: jam_group_id });

    const created_timestamp = Date.now();

    if (!existing_group) {
      res.status(400).json({
        message: "Jam Group not found",
      });
    } else {
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

      await new_jam.save();
      await JamGroup.findByIdAndUpdate(jam_group_id, {
        $push: { jam_id },
      });

      res.status(200).json({ message: "Jam Created", jam: new_jam });
    }
  } catch (error) {
    console.log("there was an error creating the authentication");
    res.status(500).json({ message: error.message, full_error: error });
  }
});

app.get("/jam_group/:id?", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { id } = req.query;
    const { user_id } = req.user.userId;

    // if id is supplied, get info on single jam group
    if (id) {
      const jam_group = await JamGroup.findById({ _id: id });
      res.status(200).json({
        message: "Jam Group Found",
        jam_group,
      });
      // if group id not supplied get all jam groups user is subscribed to
    } else if (user_id && id === undefined) {
      const user = await User.findById({ _id: user_id });
      console.log("user jam groups", user.jam_groups);
      const jam_groups = await JamGroup.find({ _id: { $in: user.jam_groups } });

      res.status(200).json({
        message: "User groups found",
        jam_groups,
      });
    }
  } catch (error) {
    res.status(500).json({
      message: "Failed to authenticate",
      error_message: error.message,
    });
  }
});

app.get("/jams/:group_id?", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
    const { group_id } = req.params;
    console.log("group id", group_id);
    const { user_id } = req.body;

    if (group_id !== undefined) {
      const jam_group = await JamGroup.findById({ _id: group_id });
      const jams = await Jam.find({ _id: { $in: jam_group.jam_id } });

      res.status(200).json({
        message: "Jams found",
        count: jams.length,
        jams,
      });
    } else if (user_id !== undefined) {
      const user = await User.findById({ _id: user_id });
      const user_groups = user.jam_groups;

      const user_jams = await Jam.find({ jam_group_id: { $in: user_groups } });
      res.status(200).json({
        message: "Jams Found",
        count: user_jams.length,
        jams: user_jams,
      });
    } else {
      res.status(400).json({
        message: "Please provide group_id or user_id",
      });
    }
  } catch (error) {
    console.error("There was an error retrieving jams:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

//###########################################################################

// Add a POST endpoint for creating a JamNote
app.post("/jam_note/:jam_id", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { note, jam_group_id, user_id } = req.body;
    const { jam_id } = req.params;

    const created_timestamp = Date.now();
    const jam_note_id = uuidv4();

    const new_jam_note = new JamNote({
      note,
      jam_id,
      user_id,
      jam_group_id,
      created_timestamp,
      _id: jam_note_id,
    });

    await new_jam_note.save();

    await User.findByIdAndUpdate(user_id, {
      $push: { jam_notes: new_jam_note },
    });

    await Jam.findByIdAndUpdate(jam_id, {
      $push: { jam_notes: new_jam_note },
    });

    await JamGroup.findByIdAndUpdate(jam_group_id, {
      $push: { jam_notes: new_jam_note },
    });

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

    const user = await User.findById({ _id: user_id });
    const jamNotes = user.jam_notes;

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

app.post("/jam_task/:jam_id", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
    const task_id = uuidv4();

    const {
      title,
      tasked_users = [user_id],
      complete_by_timestamp,
      user_id,
    } = req.body;
    const { jam_id } = req.params;

    const new_task = new JamTask({
      title,
      tasked_users,
      complete_by_timestamp,
      status: "incomplete",
      _id: task_id
    });

    await new_task.save();

    await User.findByIdAndUpdate(user_id, {
      $push: { $in: { jam_tasks: new_task } },
    });
    await Jam.findByIdAndUpdate(jam_id, {
      $push: { $in: { jam_tasks: new_task } },
    });
  } catch (error) {
    res.status(500).json({
      message: "Error creating task",
      error,
    });
  }
});

app.get("/jam_task/:id", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
    const { id } = req.params;

    const task = JamTask.findById({ _id: id });
  }
  catch (error) {
    res.status(500).json({
      message: "Error fetching task",
      error,
    });
  }
})

app.put("/jam_tasks/:id", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
    const { id } = req.params;
    const { title, tasked_users, complete_by_timestamp, status } = req.body;

    // Find the JamTask by ID
    const task = await JamTask.findById(id);

    if (!task) {
      return res.status(404).json({ message: "JamTask not found" });
    }

    // Ensure that created timestamp, _id, and jam_id do not change
    const { created_timestamp, _id, jam_id } = task;
    const compare_diff = {
      tasked_users: task.tasked_users
    }

    // Update only the fields provided in the request body
    task.title = title || task.title;
    task.tasked_users = tasked_users || task.tasked_users;
    task.complete_by_timestamp = complete_by_timestamp || task.complete_by_timestamp;
    task.status = status || task.status;

    // Save the updated JamTask document
    const updatedTask = await task.save();

    if (compare_diff.tasked_users !== task.tasked_users) {
      User.findByIdAndUpdate({ _id: { $in: arrayDifference(compare_diff.tasked_users, task.tasked_users) } },
        {
          $push: { jam_tasks: task }
        }
      );
    }

    res.status(200).json({ message: "JamTask updated successfully", updatedTask });
  } catch (error) {
    console.error("There was an error updating the JamTask:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


// Add a DELETE endpoint for deleting a jam by custom id
app.delete("/jam/:id", authenticateJWT, async (req, res) => {
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
